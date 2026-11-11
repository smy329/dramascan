// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LoadingIndicator } from '@/components/states/loading-indicator';

afterEach(cleanup);

describe('LoadingIndicator', () => {
  it('renders one polite status region with a hidden spinner', () => {
    render(<LoadingIndicator />);

    const status = screen.getByRole('status');
    const spinner = status.querySelector('svg');

    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.querySelector('.sr-only')?.textContent).toBe('Loading');
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    expect(spinner?.getAttribute('class')).toContain('animate-spin');
    expect(spinner?.getAttribute('class')).toContain('motion-reduce:animate-none');
  });

  it('supports a custom accessible label', () => {
    render(<LoadingIndicator label="Loading episodes" />);
    expect(screen.getByRole('status').textContent).toBe('Loading episodes');
  });

  it('applies the inline layout by default', () => {
    render(<LoadingIndicator />);
    expect(screen.getByRole('status').className).toContain('inline-flex');
  });

  it('applies the block layout', () => {
    render(<LoadingIndicator variant="block" />);
    const status = screen.getByRole('status');
    expect(status.className).toContain('flex');
    expect(status.className).toContain('py-8');
  });

  it.each([
    ['sm', 'size-4'],
    ['md', 'size-5'],
    ['lg', 'size-6'],
  ] as const)('renders the %s spinner size', (size, expected) => {
    render(<LoadingIndicator size={size} />);
    expect(screen.getByRole('status').querySelector('svg')?.getAttribute('class')).toContain(
      expected
    );
  });
});
