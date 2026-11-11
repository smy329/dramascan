import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(file: string): string {
  return readFileSync(new URL(`../../../src/components/states/${file}`, import.meta.url), 'utf8');
}

describe('state component server/client boundaries', () => {
  it('keeps RetryState server-compatible', () => {
    expect(source('retry-state.tsx').trimStart().startsWith("'use client'")).toBe(false);
  });

  it('keeps RetryButton a client island', () => {
    expect(source('retry-button.tsx').trimStart().startsWith("'use client'")).toBe(true);
  });
});
