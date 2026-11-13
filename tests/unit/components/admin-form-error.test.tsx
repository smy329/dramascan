// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { AdminFormError } from '@/components/admin/forms/admin-form-error';

afterEach(cleanup);

describe('AdminFormError', () => {
  it('renders an alert with the default title and message', () => {
    render(<AdminFormError message="The drama could not be saved." />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Could not save' })).toBeTruthy();
    expect(screen.getByText('The drama could not be saved.')).toBeTruthy();
  });

  it('renders a custom title and message', () => {
    render(<AdminFormError title="Could not publish" message="Publishing failed." />);

    expect(screen.getByRole('heading', { level: 2, name: 'Could not publish' })).toBeTruthy();
    expect(screen.getByText('Publishing failed.')).toBeTruthy();
  });

  it('renders the optional action slot', () => {
    render(
      <AdminFormError message="The drama could not be saved.">
        <button type="button">Try again</button>
      </AdminFormError>
    );

    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
