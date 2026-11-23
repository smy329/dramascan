/**
 * Detection of a video upload or processing pipeline.
 *
 * Prompts 080–090 remove every remnant of such a pipeline: upload endpoints,
 * staging directories, temp video storage, multipart or resumable upload
 * code, upload progress, upload retries, upload cleanup, transcoding,
 * processing workers, and a video proxy, relay, or rehost.
 *
 * The detector has to be precise in both directions. It must catch a real
 * pipeline, and it must not catch:
 *
 *   - the poster and banner image upload, which is an approved feature
 *     (D-038);
 *   - the prose that explains why those things are absent — "the server never
 *     transcodes", "there is no staging directory" — which is documentation,
 *     not code.
 *
 * That is why the patterns are matched against **code only**: comments are
 * stripped before anything is matched. A pattern may therefore use ordinary
 * words like "staging" or "transcode" without tripping over the explanation
 * of why the thing is absent.
 */

/** A pattern that indicates a video upload or processing pipeline. */
export type VideoPipelinePattern = {
  /** What the pattern detects. */
  label: string;
  /** The pattern itself. Matched against code, never against comments. */
  pattern: RegExp;
};

/**
 * The patterns.
 *
 * Every pattern is video-specific. The image upload path is allowed to use
 * multipart requests, upload directories, and upload progress: the guard must
 * not reject an approved feature.
 */
export const VIDEO_PIPELINE_PATTERNS: readonly VideoPipelinePattern[] = [
  {
    label: 'video upload',
    pattern: /\b(video|movie|episode)[_-]?upload\b|\bupload[_-]?(video|movie|episode)\b/i,
  },
  { label: 'resumable upload', pattern: /\bresumable\b|\btus[_-]?(upload|protocol|endpoint)\b/i },
  {
    label: 'upload id, session, part, or chunk',
    pattern: /\b(upload|chunk)[_-]?(id|session|part|chunk)\b/i,
  },
  { label: 'staging directory', pattern: /\bstaging\w*/i },
  {
    label: 'temporary video storage',
    pattern: /\b(video|movie|episode)[_-]?(temp|tmp)\b|\btemp[_-]?video|\btmp[_-]?video/i,
  },
  {
    label: 'transcoding or media processing',
    pattern: /\btranscod\w*|\bffmpeg\b|\bffprobe\b/i,
  },
  {
    label: 'adaptive streaming manifest',
    pattern: /\bm3u8\b|\b(mpegdash|dash[_-]?manifest)\b|\bhlss?\b/i,
  },
  {
    label: 'processing worker',
    pattern: /\bworker[_-]?threads?\b|\b(video|movie|episode)[_-]?worker\b|\bworker[_-]?pool\b/i,
  },
  { label: 'background job queue', pattern: /\b(pg[-_]?boss|bullmq)\b/i },
  {
    label: 'video proxy',
    pattern: /\b(video|media)[_-]?proxy\b|\bproxy[_-]?(video|media)\b/i,
  },
  {
    label: 'video relay',
    pattern: /\b(video|media)[_-]?relay\b|\brelay[_-]?(video|media)\b/i,
  },
  {
    label: 'video rehost',
    pattern: /\b(video|media)[_-]?rehost\b|\brehost[_-]?(video|media)\b/i,
  },
  {
    label: 'upload progress',
    pattern: /\bupload[_-]?progress\b/i,
  },
  {
    label: 'upload retry or cleanup',
    pattern: /\bupload[_-]?(retry|cleanup|expire)\b|\b(cleanup|expire)[_-]?upload\b/i,
  },
  {
    label: 'server-side fetch of the media source',
    pattern:
      /\b(fetch|axios|got)\s*\(\s*[^)]{0,120}\b(videoSource|sourceUrl|video_source|source_url|mediaSource)\b/i,
  },
];

/** Characters that can precede the start of a regular-expression literal. */
const REGEX_PRECEDERS = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '~',
  '^',
]);

/**
 * Remove comments from a source file.
 *
 * The scanner tracks string literals and regular-expression literals so that
 * a `//` inside a URL or a regex is not mistaken for the start of a comment.
 * The result is not valid source code — it is a string that contains only the
 * code, which is all the detector needs.
 */
export function stripComments(source: string): string {
  let result = '';
  let index = 0;

  while (index < source.length) {
    const character = source[index]!;
    const next = source[index + 1];

    if (character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index++;
      }

      continue;
    }

    if (character === '/' && next === '*') {
      index += 2;

      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        // Keep the line structure so that a removed block comment does not
        // join two lines that were never joined.
        if (source[index] === '\n') {
          result += '\n';
        }

        index++;
      }

      index += 2;
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      const literal = copyStringLiteral(source, index);

      result += literal.text;
      index = literal.nextIndex;
      continue;
    }

    if (character === '/' && startsRegexLiteral(source, index)) {
      const literal = copyRegexLiteral(source, index);

      result += literal.text;
      index = literal.nextIndex;
      continue;
    }

    result += character;
    index++;
  }

  return result;
}

/** A copied literal and the index just after it. */
type CopiedLiteral = {
  /** The literal, verbatim. */
  text: string;
  /** The index just after the literal. */
  nextIndex: number;
};

/**
 * Copy a string literal verbatim.
 */
function copyStringLiteral(source: string, start: number): CopiedLiteral {
  const quote = source[start]!;
  let index = start + 1;
  let text = quote;

  while (index < source.length) {
    const character = source[index]!;

    if (character === '\\') {
      const escaped = source[index + 1];

      if (escaped === undefined) {
        text += character;
        index++;
        break;
      }

      text += character + escaped;
      index += 2;
      continue;
    }

    text += character;
    index++;

    if (character === quote) {
      break;
    }
  }

  return { text, nextIndex: index };
}

/**
 * Copy a regular-expression literal verbatim.
 */
function copyRegexLiteral(source: string, start: number): CopiedLiteral {
  let index = start + 1;
  let text = '/';

  while (index < source.length) {
    const character = source[index]!;

    if (character === '\\') {
      const escaped = source[index + 1];

      if (escaped === undefined) {
        text += character;
        index++;
        break;
      }

      text += character + escaped;
      index += 2;
      continue;
    }

    text += character;
    index++;

    if (character === '/') {
      break;
    }
  }

  // The flags follow the closing slash and belong to the literal.
  while (index < source.length && /[a-z]/i.test(source[index]!)) {
    text += source[index];
    index++;
  }

  return { text, nextIndex: index };
}

/**
 * Does the slash at `index` start a regular-expression literal?
 *
 * A slash starts a regex when the previous meaningful character cannot end an
 * expression. Division (`a / b`) is therefore not mistaken for a regex.
 */
function startsRegexLiteral(source: string, index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const character = source[cursor]!;

    if (/\s/.test(character)) {
      continue;
    }

    return REGEX_PRECEDERS.has(character);
  }

  return true;
}

/**
 * Find the video-pipeline patterns a source file matches.
 *
 * @param source The file's contents.
 * @returns the labels of the patterns that matched.
 */
export function findVideoPipelineViolations(source: string): string[] {
  const code = stripComments(source);

  return VIDEO_PIPELINE_PATTERNS.filter(({ pattern }) => pattern.test(code)).map(
    ({ label }) => label
  );
}
