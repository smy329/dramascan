import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(file: string): string {
  return readFileSync(new URL(`../../../src/components/dialogs/${file}`, import.meta.url), 'utf8');
}

describe('dialog component server/client boundaries', () => {
  it('keeps ConfirmationDialog a client component', () => {
    expect(source('confirmation-dialog.tsx').trimStart().startsWith("'use client'")).toBe(true);
  });

  it('keeps ConsequenceList server-compatible', () => {
    expect(source('consequence-list.tsx').trimStart().startsWith("'use client'")).toBe(false);
  });
});
