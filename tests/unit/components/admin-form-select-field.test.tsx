// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import type { JSX } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';

import { AdminFormSelectField } from '@/components/admin/forms/admin-form-select-field';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
] as const;

function Harness(): JSX.Element {
  const methods = useForm<Record<string, unknown>>({ defaultValues: { kind: 'b' } });

  return (
    <FormProvider {...methods}>
      <AdminFormSelectField
        name="kind"
        label="Kind"
        required
        hint="Pick one."
        options={OPTIONS}
      />
    </FormProvider>
  );
}

afterEach(cleanup);

describe('AdminFormSelectField', () => {
  it('renders the labelled select, every option, the hint and the current value', () => {
    render(<Harness />);

    const select = screen.getByLabelText('Kind *');

    expect(select.tagName).toBe('SELECT');
    expect((select as HTMLSelectElement).value).toBe('b');
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeTruthy();
    expect(screen.getByText('Pick one.')).toBeTruthy();
  });
});
