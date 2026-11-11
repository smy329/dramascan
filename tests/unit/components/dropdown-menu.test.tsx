// @vitest-environment jsdom

import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

afterEach(cleanup);

it('opens the menu from its trigger', async () => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button">Open menu</button>} />
      <DropdownMenuContent>
        <DropdownMenuItem>First action</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

  expect(await screen.findByRole('menu')).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: 'First action' })).toBeTruthy();
});
