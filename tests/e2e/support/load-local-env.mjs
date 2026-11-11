// Loads `.env.local` with dotenv's parser while tolerating the encoding the
// file is actually saved in. The repository's local environment file may be
// UTF-16 LE (with a BOM); `dotenv.config()` assumes UTF-8 and silently loads
// nothing in that case.
//
// Existing process environment variables always win, matching dotenv and
// Next.js precedence.

import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

const ENV_FILE = '.env.local';

export function loadLocalEnv() {
  let contents;

  try {
    contents = readFileSync(ENV_FILE);
  } catch {
    // No local file: CI and other environments provide variables directly.
    return;
  }

  const parsed = parse(decode(contents));

  for (const [key, value] of Object.entries(parsed)) {
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function decode(contents) {
  if (contents.length >= 2 && contents[0] === 0xff && contents[1] === 0xfe) {
    return contents.subarray(2).toString('utf16le');
  }

  if (contents.length >= 2 && contents[0] === 0xfe && contents[1] === 0xff) {
    const body = Buffer.from(contents.subarray(2));

    if (body.length % 2 === 0) {
      body.swap16();
    }

    return body.toString('utf16le');
  }

  return contents.toString('utf8').replace(/^\uFEFF/, '');
}
