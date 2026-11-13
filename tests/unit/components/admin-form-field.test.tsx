// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';

import { AdminFormField } from '@/components/admin/forms/admin-form-field';

afterEach(cleanup);

function Harness({ children }: { children?: ReactNode }) {
  const methods = useForm({ defaultValues: { title: '' } });

  return (
    <FormProvider {...methods}>
      {children}
      <button
        type="button"
        onClick={() => methods.setError('title', { type: 'required', message: 'Title is required.' })}
      >
        set-error
      </button>
    </FormProvider>
  );
}

describe('AdminFormField', () => {
  it('associates the label with the control', () => {
    render(
      <Harness>
        <AdminFormField name="title" label="Title" />
      </Harness>
    );

    expect(screen.getByLabelText('Title')).toBeTruthy();
  });

  it('renders the hint when provided', () => {
    render(
      <Harness>
        <AdminFormField name="title" label="Title" hint="Shown publicly." />
      </Harness>
    );

    expect(screen.getByText('Shown publicly.')).toBeTruthy();
  });

  it('renders the validation error from the form context and wires the aria attributes', () => {
    render(
      <Harness>
        <AdminFormField name="title" label="Title" />
      </Harness>
    );

    fireEvent.click(screen.getByRole('button', { name: 'set-error' }));

    const control = screen.getByLabelText('Title') as HTMLInputElement;

    expect(screen.getByText('Title is required.')).toBeTruthy();
    expect(control.getAttribute('aria-invalid')).toBe('true');
    expect(control.getAttribute('aria-describedby')).toBe('title-error');
  });

  it('appends a marker to the label when the field is required', () => {
    render(
      <Harness>
        <AdminFormField name="title" label="Title" required />
      </Harness>
    );

    expect(screen.getByText('Title *')).toBeTruthy();
  });
});
