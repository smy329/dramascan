// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AlertTriangle } from 'lucide-react';

import { RetryState } from '@/components/states/retry-state';
import { RetryButton } from '@/components/states/retry-button';
import type { HeadingLevel } from '@/components/states/heading';

afterEach(cleanup);

describe('RetryState', () => {
  it('renders an alert with title, description, decorative icon, and action', () => {
    const { container } = render(
      <RetryState title="Could not load dramas" description="Check your connection and try again.">
        <a href="/drama">Try again</a>
      </RetryState>
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Could not load dramas' })).toBeTruthy();
    expect(screen.getByText('Check your connection and try again.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/drama');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('accepts a custom icon and heading level', () => {
    render(<RetryState title="Could not load" icon={AlertTriangle} headingLevel={3} />);

    expect(screen.getByRole('heading', { level: 3, name: 'Could not load' })).toBeTruthy();
  });

  it('falls back to h2 for an out-of-range level', () => {
    render(<RetryState title="Could not load" headingLevel={9 as HeadingLevel} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Could not load' })).toBeTruthy();
  });
});

describe('RetryButton', () => {
  it('renders its label and calls onRetry once', () => {
    const onRetry = vi.fn();
    render(<RetryButton onRetry={onRetry} />);

    const button = screen.getByRole('button', { name: 'Try again' });
    fireEvent.click(button);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables while retrying, announces feedback, and blocks duplicate clicks', () => {
    const onRetry = vi.fn();
    render(<RetryButton onRetry={onRetry} isRetrying />);

    const button = screen.getByRole('button', { name: 'Retrying…' }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.querySelector('svg')?.getAttribute('class')).toContain(
      'motion-reduce:animate-none'
    );
    expect(screen.getByRole('status').textContent).toBe('Retrying…');

    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('does not call onRetry while the disabled prop is set', () => {
    const onRetry = vi.fn();
    render(<RetryButton onRetry={onRetry} disabled />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('becomes clickable again after retrying completes', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<RetryButton onRetry={onRetry} isRetrying />);

    rerender(<RetryButton onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('supports custom labels', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <RetryButton onRetry={onRetry} label="Reload" isRetrying={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    rerender(
      <RetryButton onRetry={onRetry} label="Reload" retryingLabel="Reloading…" isRetrying />
    );

    expect(screen.getByRole('button', { name: 'Reloading…' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Reloading…');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
