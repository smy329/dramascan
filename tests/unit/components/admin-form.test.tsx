// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { z } from 'zod';

import { AdminForm } from '@/components/admin/forms/admin-form';
import { AdminFormField } from '@/components/admin/forms/admin-form-field';
import type { ActionResult } from '@/lib/contracts/common';

afterEach(cleanup);

const titleSchema = z.object({ title: z.string().min(1, 'Title is required.') });

type AdminFormServerAction = (_payload: unknown) => Promise<ActionResult<unknown>>;

function Harness({
  serverAction,
  onSuccess,
  defaultValues,
}: {
  serverAction: AdminFormServerAction;
  onSuccess?: (_data: unknown) => void | Promise<void>;
  defaultValues?: Readonly<Record<string, unknown>>;
}) {
  return (
    <AdminForm
      schema={titleSchema}
      serverAction={serverAction}
      onSuccess={onSuccess}
      defaultValues={defaultValues}
    >
      <AdminFormField name="title" label="Title" />
    </AdminForm>
  );
}

describe('AdminForm', () => {
  it('renders the fields and the submit control', () => {
    const serverAction = vi.fn(async () => ({ ok: true, data: { title: 'Midnight Signal' } }));
    render(<Harness serverAction={serverAction} />);

    expect(screen.getByLabelText('Title')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('submits the parsed values to the server action and resets on success', async () => {
    const serverAction = vi.fn(async () => ({ ok: true, data: { title: 'Midnight Signal' } }));
    const onSuccess = vi.fn(async () => undefined);
    render(<Harness serverAction={serverAction} onSuccess={onSuccess} defaultValues={{ title: '' }} />);

    const input = screen.getByLabelText('Title') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Midnight Signal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(serverAction).toHaveBeenCalledWith({ title: 'Midnight Signal' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(''));
  });

  it('does not call the server action and shows the resolver error when validation fails', async () => {
    const serverAction = vi.fn(async () => ({ ok: true, data: { title: 'Midnight Signal' } }));
    render(<Harness serverAction={serverAction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Title is required.')).toBeTruthy());
    expect(serverAction).not.toHaveBeenCalled();
  });

  it('renders the server error and maps server field errors on failure', async () => {
    const serverAction = vi.fn(async () => ({
      ok: false,
      error: {
        code: 'validation_error',
        message: 'The request contains invalid fields.',
        fieldErrors: { title: ['Title is required.'] },
      },
    }));
    render(<Harness serverAction={serverAction} />);

    const input = screen.getByLabelText('Title') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Midnight Signal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('The request contains invalid fields.')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Title is required.')).toBeTruthy());
  });

  it('disables the submit control and shows the pending label while saving', async () => {
    let resolveSave: (_value: ActionResult<unknown>) => void = () => undefined;
    const serverAction = vi.fn(
      () =>
        new Promise<ActionResult<unknown>>(resolve => {
          resolveSave = resolve;
        })
    );
    render(<Harness serverAction={serverAction} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Midnight Signal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const button = screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    await waitFor(() => expect(serverAction).toHaveBeenCalled());
    await act(async () => {
      resolveSave({ ok: true, data: { title: 'Midnight Signal' } });
    });
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull(), {
      timeout: 3000,
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
