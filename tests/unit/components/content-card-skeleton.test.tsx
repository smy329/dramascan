// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ContentCardSkeleton } from '@/components/states/content-card-skeleton';
import { SkeletonGroup } from '@/components/states/skeleton';

afterEach(cleanup);

describe('ContentCardSkeleton', () => {
  it('is decorative and mirrors the content card dimensions', () => {
    const { container } = render(<ContentCardSkeleton />);
    const root = container.querySelector('[data-slot="content-card-skeleton"]');
    const poster = container.querySelector('[data-slot="content-card-skeleton-poster"]');

    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(root?.className).toContain('w-full');
    expect(root?.className).toContain('min-w-0');
    expect(poster?.className).toContain('aspect-[2/3]');
    expect(poster?.className).toContain('rounded-xl');
    expect(poster?.className).toContain('animate-pulse');
    expect(poster?.className).toContain('motion-reduce:animate-none');
  });

  it('renders three text bones and no semantic content', () => {
    const { container } = render(<ContentCardSkeleton />);

    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    expect(container.querySelector('h1,h2,h3,h4,h5,h6')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('merges className', () => {
    const { container } = render(<ContentCardSkeleton className="w-40" />);
    expect(container.querySelector('[data-slot="content-card-skeleton"]')?.className).toContain(
      'w-40'
    );
  });

  it('does not create per-card announcements inside a group', () => {
    render(
      <SkeletonGroup>
        <ContentCardSkeleton />
        <ContentCardSkeleton />
      </SkeletonGroup>
    );

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('Loading content');
  });
});
