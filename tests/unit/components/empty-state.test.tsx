// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Clapperboard } from 'lucide-react';

import { EmptyState } from '@/components/states/empty-state';
import type { HeadingLevel } from '@/components/states/heading';

afterEach(cleanup);

describe('EmptyState', () => {
  it('renders an h2 title by default with a decorative icon', () => {
    const { container } = render(
      <EmptyState icon={Clapperboard} title="Nothing here" description="Come back later." />
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Nothing here' })).toBeTruthy();
    expect(screen.getByText('Come back later.')).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it.each([1, 3, 4, 5, 6] as const)('renders an h%i for headingLevel', level => {
    render(<EmptyState icon={Clapperboard} title="Nothing here" headingLevel={level} />);
    expect(screen.getByRole('heading', { level, name: 'Nothing here' })).toBeTruthy();
  });

  it('falls back to h2 for an out-of-range level', () => {
    render(
      <EmptyState icon={Clapperboard} title="Nothing here" headingLevel={9 as HeadingLevel} />
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing here' })).toBeTruthy();
  });

  it('omits the description and action slot when they are not supplied', () => {
    const { container } = render(<EmptyState icon={Clapperboard} title="Nothing here" />);

    expect(container.querySelector('p')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders an action in the children slot and merges className', () => {
    const { container } = render(
      <EmptyState icon={Clapperboard} title="Nothing here" className="max-w-md">
        <a href="/browse">Browse dramas</a>
      </EmptyState>
    );

    expect(screen.getByRole('link', { name: 'Browse dramas' }).getAttribute('href')).toBe(
      '/browse'
    );
    expect(container.querySelector('[data-slot="empty-state"]')?.className).toContain('max-w-md');
  });
});
