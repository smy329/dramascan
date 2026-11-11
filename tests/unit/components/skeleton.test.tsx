// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { Skeleton, SkeletonGroup } from '@/components/states/skeleton';

afterEach(cleanup);

describe('Skeleton', () => {
  it('defaults to a text line, is decorative, and merges className', () => {
    const { container } = render(<Skeleton className="w-24" />);
    const bone = container.querySelector('[data-slot="skeleton"]');

    expect(bone?.getAttribute('aria-hidden')).toBe('true');
    expect(bone?.className).toContain('animate-pulse');
    expect(bone?.className).toContain('motion-reduce:animate-none');
    expect(bone?.className).toContain('h-4');
    expect(bone?.className).toContain('w-24');
  });

  it.each([
    ['circle', 'rounded-full'],
    ['rectangle', 'rounded-xl'],
  ] as const)('renders the %s variant', (variant, shape) => {
    const { container } = render(<Skeleton variant={variant} />);
    expect(container.querySelector('[data-slot="skeleton"]')?.className).toContain(shape);
  });
});

describe('SkeletonGroup', () => {
  it('announces once for many decorative children', () => {
    const { container } = render(
      <SkeletonGroup>
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </SkeletonGroup>
    );

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.getAttribute('aria-live')).toBe('polite');
    expect(statuses[0]?.textContent).toBe('Loading content');

    for (const bone of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(bone.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('accepts a custom announcement label', () => {
    render(
      <SkeletonGroup label="Loading dramas">
        <Skeleton />
      </SkeletonGroup>
    );

    expect(screen.getByRole('status').textContent).toBe('Loading dramas');
  });

  it('does not impose its own grid or flex layout', () => {
    render(
      <SkeletonGroup>
        <Skeleton />
      </SkeletonGroup>
    );

    expect(screen.getByRole('status').className).not.toContain('grid');
    expect(screen.getByRole('status').className).not.toContain('flex');
  });
});
