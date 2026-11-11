// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ConsequenceList } from '@/components/dialogs/consequence-list';

afterEach(cleanup);

describe('ConsequenceList', () => {
  it('renders one list item per consequence', () => {
    render(<ConsequenceList items={['Bookmarks are removed.', 'Ratings are anonymised.']} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Bookmarks are removed.')).toBeTruthy();
  });

  it('renders nothing when there are no items', () => {
    const { container } = render(<ConsequenceList items={[]} />);
    expect(container.querySelector('ul')).toBeNull();
  });

  it('applies an accessible label', () => {
    render(<ConsequenceList label="What happens next" items={['Progress resets.']} />);
    expect(screen.getByRole('list', { name: 'What happens next' })).toBeTruthy();
  });

  it('uses neutral styling and merges className', () => {
    const { container } = render(<ConsequenceList items={['Progress resets.']} className="mt-4" />);
    const list = container.querySelector('ul');

    expect(list?.className).not.toContain('destructive');
    expect(list?.className).toContain('mt-4');
  });
});
