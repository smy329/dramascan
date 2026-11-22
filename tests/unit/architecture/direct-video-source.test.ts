import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Architectural guard for the direct-MP4 video source architecture.
 *
 * The initial implementation stores a public, direct HTTPS MP4 URL per episode
 * and plays it in the browser. There is no Odysee/LBRY integration, no video
 * upload or staging, no transcoding, and no backend proxy or rehost.
 *
 * The references to Odysee and LBRY in the documentation are deliberate: they
 * record the exclusion. This guard therefore checks the *code* and the
 * *dependency manifest*, where a provider-specific client, SDK, credential, or
 * upload workflow would actually live.
 */

const PROJECT_ROOT = process.cwd();

const SOURCE_DIRECTORIES = ['src', 'scripts'];

const FILE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.json', '.sql'];

const FORBIDDEN_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'Odysee', pattern: /\bodysee\b/i },
  { label: 'LBRY', pattern: /\blbry\b/i },
  { label: 'claim id', pattern: /\bclaim[_-]?id\b/i },
  { label: 'upload endpoint', pattern: /\b(upload|staging)[_-]?(url|endpoint|token)\b/i },
];

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return listFiles(path);
    }

    return FILE_EXTENSIONS.some(extension => path.endsWith(extension)) ? [path] : [];
  });
}

function readSources(): { file: string; source: string }[] {
  return SOURCE_DIRECTORIES.flatMap(directory => listFiles(join(PROJECT_ROOT, directory))).map(
    file => ({
      file: relative(PROJECT_ROOT, file).split('\\').join('/'),
      source: readFileSync(file, 'utf8'),
    })
  );
}

function readPackageManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('direct MP4 source architecture', () => {
  it('contains no Odysee or LBRY client, SDK, credential, or workflow', () => {
    const offenders = readSources()
      .flatMap(({ file, source }) =>
        FORBIDDEN_PATTERNS.flatMap(({ label, pattern }) =>
          (pattern.test(source) ? [{ file, label }] : [])
        )
      )
      .map(({ file, label }) => `${file} (${label})`);

    expect(offenders).toEqual([]);
  });

  it('declares no provider-specific dependency', () => {
    const manifest = readPackageManifest();
    const dependencies = {
      ...(manifest.dependencies as Record<string, string> | undefined),
      ...(manifest.devDependencies as Record<string, string> | undefined),
    };
    const names = Object.keys(dependencies);

    const offenders = names.filter(name =>
      FORBIDDEN_PATTERNS.some(({ pattern }) => pattern.test(name))
    );

    expect(offenders).toEqual([]);
  });

  it('still finds the source files it is meant to protect', () => {
    expect(readSources().length).toBeGreaterThan(0);
  });
});
