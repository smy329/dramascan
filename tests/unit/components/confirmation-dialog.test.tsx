// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import { ConsequenceList } from '@/components/dialogs/consequence-list';

afterEach(cleanup);

const BASE_PROPS = {
  title: 'Delete drama',
  onConfirm: () => {},
} as const;

describe('ConfirmationDialog lifecycle', () => {
  it('renders nothing while closed', () => {
    render(<ConfirmationDialog {...BASE_PROPS} open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('renders the title and description when open', async () => {
    render(
      <ConfirmationDialog
        {...BASE_PROPS}
        open
        onOpenChange={() => {}}
        description="This moves the drama to Trash."
      />
    );

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Delete drama' })).toBeTruthy();
    expect(screen.getByText('This moves the drama to Trash.')).toBeTruthy();
  });

  it('opens from its trigger', async () => {
    render(
      <ConfirmationDialog
        {...BASE_PROPS}
        defaultOpen={false}
        trigger={<button type="button">Delete drama</button>}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete drama' }));

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('renders an open dialog with defaultOpen', async () => {
    render(<ConfirmationDialog {...BASE_PROPS} defaultOpen />);
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('requests closure without confirming when cancelled', async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={onConfirm}
        open
        onOpenChange={onOpenChange}
      />
    );

    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms exactly once and requests closure', async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={onConfirm}
        open
        onOpenChange={onOpenChange}
      />
    );

    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('honours custom confirm and cancel labels', async () => {
    render(
      <ConfirmationDialog
        {...BASE_PROPS}
        open
        onOpenChange={() => {}}
        confirmLabel="Move to Trash"
        cancelLabel="Keep it"
      />
    );

    await screen.findByRole('alertdialog');
    expect(screen.getByRole('button', { name: 'Move to Trash' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy();
  });

  it('focuses Cancel when it opens', async () => {
    render(<ConfirmationDialog {...BASE_PROPS} open onOpenChange={() => {}} />);

    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
  });

  it('returns focus to the trigger after closing', async () => {
    render(
      <ConfirmationDialog {...BASE_PROPS} trigger={<button type="button">Delete drama</button>} />
    );

    const trigger = screen.getByRole('button', { name: 'Delete drama' });
    fireEvent.click(trigger);
    await screen.findByRole('alertdialog');

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe('ConfirmationDialog pending state', () => {
  it('disables both actions, announces busy, and blocks duplicates', async () => {
    const onConfirm = vi.fn();

    render(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={onConfirm}
        open
        onOpenChange={() => {}}
        isPending
      />
    );

    const confirm = (await screen.findByRole('button', { name: 'Working…' })) as HTMLButtonElement;
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;

    expect(confirm.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(confirm.querySelector('svg')?.getAttribute('class')).toContain(
      'motion-reduce:animate-none'
    );

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('supports a custom pending label', async () => {
    render(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={() => {}}
        open
        onOpenChange={() => {}}
        isPending
        pendingLabel="Deleting…"
      />
    );

    expect(await screen.findByRole('button', { name: 'Deleting…' })).toBeTruthy();
  });

  it('ignores Escape while pending but closes otherwise', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={() => {}}
        open
        onOpenChange={onOpenChange}
        isPending
      />
    );

    await screen.findByRole('alertdialog');
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();

    rerender(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={() => {}}
        open
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ConfirmationDialog variant and sections', () => {
  it('styles the confirm action destructively', async () => {
    render(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={() => {}}
        open
        onOpenChange={() => {}}
        variant="destructive"
      />
    );

    const confirm = await screen.findByRole('button', { name: 'Confirm' });
    expect(confirm.className).toContain('text-destructive');
  });

  it('renders affected content and consequences with labels', async () => {
    render(
      <ConfirmationDialog
        title="Permanently delete drama"
        onConfirm={() => {}}
        open
        onOpenChange={() => {}}
        affectedContent={<p>Midnight Signal · 3 seasons · 24 episodes</p>}
        consequences={
          <ConsequenceList
            items={['Bookmarks and progress are removed.', 'Ratings stay anonymous.']}
          />
        }
      />
    );

    await screen.findByRole('alertdialog');

    expect(screen.getByRole('heading', { level: 3, name: 'Affected content' })).toBeTruthy();
    expect(screen.getByText('Midnight Signal · 3 seasons · 24 episodes')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Consequences' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('supports custom section labels', async () => {
    render(
      <ConfirmationDialog
        title="Replace source"
        onConfirm={() => {}}
        open
        onOpenChange={() => {}}
        affectedContent={<p>Episode 4</p>}
        affectedContentLabel="Episode"
        consequences={<ConsequenceList items={['Progress resets.']} />}
        consequencesLabel="What changes"
      />
    );

    await screen.findByRole('alertdialog');
    expect(screen.getByRole('heading', { level: 3, name: 'Episode' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'What changes' })).toBeTruthy();
  });

  it('renders no sections when content is omitted', async () => {
    const { container } = render(
      <ConfirmationDialog title="Restore drama" onConfirm={() => {}} open onOpenChange={() => {}} />
    );

    await screen.findByRole('alertdialog');
    expect(container.querySelectorAll('h3')).toHaveLength(0);
    expect(screen.queryByRole('list')).toBeNull();
  });
});
