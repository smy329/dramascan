// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ContentCard } from '@/components/public/ContentCard';

afterEach(cleanup);

const BASE_PROPS = {
  kind: 'drama',
  title: 'Midnight Signal',
} as const;

describe('ContentCard', () => {
  it('renders a drama title, content type, and portrait poster', () => {
    const { container } = render(
      <ContentCard {...BASE_PROPS} poster="https://cdn.example.com/midnight.jpg" />
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Midnight Signal' })).toBeTruthy();
    expect(screen.getByText('Drama')).toBeTruthy();

    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://cdn.example.com/midnight.jpg');
    expect(image?.getAttribute('alt')).toBe('');

    const article = container.querySelector('article');
    expect(article?.className).toContain('w-full');
    expect(article?.className).toContain('min-w-0');

    const poster = container.querySelector('[data-slot="content-poster"]');
    expect(poster?.className).toContain('aspect-[2/3]');
  });

  it('renders a movie content type', () => {
    render(<ContentCard kind="movie" title="The Last Tide" />);

    expect(screen.getByText('Movie')).toBeTruthy();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace', '   '],
    ['invalid', 'javascript:alert(1)'],
  ])('renders the placeholder for a %s poster', (_label, poster) => {
    const { container } = render(<ContentCard {...BASE_PROPS} poster={poster} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-slot="content-poster-placeholder"]')).not.toBeNull();
  });

  it('falls back to the placeholder when the image fails to load', () => {
    const { container } = render(
      <ContentCard {...BASE_PROPS} poster="https://cdn.example.com/midnight.jpg" />
    );

    const image = container.querySelector('img');
    expect(image).not.toBeNull();

    fireEvent.error(image as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-slot="content-poster-placeholder"]')).not.toBeNull();
  });

  it('renders a link only when a safe href is supplied', () => {
    const { rerender } = render(<ContentCard {...BASE_PROPS} href="/drama/midnight-signal" />);

    const link = screen.getByRole('link', { name: /Midnight Signal/ });
    expect(link.getAttribute('href')).toBe('/drama/midnight-signal');

    rerender(<ContentCard {...BASE_PROPS} />);
    expect(screen.queryByRole('link')).toBeNull();

    rerender(<ContentCard {...BASE_PROPS} href="javascript:alert(1)" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a caller-supplied rating with formatted count and accessible text', () => {
    render(<ContentCard {...BASE_PROPS} rating={{ average: 4.5, count: 1200 }} />);

    expect(screen.getByText('4.5 (1.2K)')).toBeTruthy();
    expect(screen.getByText('Rated 4.5 out of 5 from 1200 ratings')).toBeTruthy();
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['zero count', { average: 4.5, count: 0 }],
    ['invalid average', { average: 0, count: 1200 }],
  ])('renders no rating for a %s value', (_label, rating) => {
    render(<ContentCard {...BASE_PROPS} rating={rating} />);

    expect(screen.queryByText(/Rated /)).toBeNull();
    expect(screen.queryByText(/\(1\.2K\)/)).toBeNull();
  });

  it.each([
    ['ongoing', 'Ongoing'],
    ['completed', 'Completed'],
    ['coming-soon', 'Coming Soon'],
  ] as const)('renders the %s drama lifecycle status', (status, label) => {
    render(<ContentCard {...BASE_PROPS} status={status} />);

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText('Drama')).toBeTruthy();
  });

  it('renders no status when none is supplied', () => {
    render(<ContentCard {...BASE_PROPS} />);

    expect(screen.queryByText('Ongoing')).toBeNull();
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.queryByText('Coming Soon')).toBeNull();
  });

  it('never renders a lifecycle status for a movie', () => {
    render(<ContentCard kind="movie" title="The Last Tide" status="ongoing" />);

    expect(screen.getByText('Movie')).toBeTruthy();
    expect(screen.queryByText('Ongoing')).toBeNull();
  });
});
