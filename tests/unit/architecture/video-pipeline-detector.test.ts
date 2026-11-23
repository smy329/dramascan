import { describe, expect, it } from 'vitest';

import {
  findVideoPipelineViolations,
  stripComments,
} from './support/video-pipeline-detector';

/**
 * The video-pipeline detector.
 *
 * Prompts 080–090 remove every remnant of a video upload and processing
 * pipeline: upload endpoints, staging directories, temp video storage,
 * multipart or resumable upload code, upload progress, upload retries, upload
 * cleanup, transcoding, processing workers, and a video proxy, relay, or
 * rehost. The detector is what keeps them gone.
 *
 * It has to be precise in both directions. It must catch a real pipeline, and
 * it must not catch:
 *
 *   - the poster and banner image upload, which is an approved feature;
 *   - the prose that explains why those things are absent — "the server never
 *     transcodes", "there is no staging directory" — which is documentation,
 *     not code.
 *
 * That is why the detector looks at code only: comments are stripped before
 * anything is matched.
 */

describe('stripComments', () => {
  it('removes line comments', () => {
    expect(stripComments('const a = 1; // ffmpeg\nconst b = 2;')).not.toContain('ffmpeg');
  });

  it('removes block comments', () => {
    expect(stripComments('/* ffmpeg */ const a = 1;')).not.toContain('ffmpeg');
  });

  it('keeps a URL inside a string literal', () => {
    const source = "const url = 'https://media.example.com/ep.mp4';";

    expect(stripComments(source)).toContain('media.example.com');
  });

  it('keeps a regex literal that contains escaped slashes', () => {
    const source = 'const pattern = /^[a-z]+:\\/\\/$/i;';

    expect(stripComments(source)).toContain('^[a-z]+');
  });
});

describe('findVideoPipelineViolations', () => {
  const catches = [
    ['a video upload route', "app.post('/api/video-upload', handler);", /video upload/i],
    ['a resumable upload', 'const resumable = true;', /resumable/i],
    [
      'an upload session',
      "insert into uploads (upload_id) values ('x');",
      /upload id|upload session|upload part|upload chunk/i,
    ],
    ['a staging directory', "const stagingDir = '/var/tmp/video';", /staging/i],
    ['temporary video storage', "const tempVideoPath = '/tmp/episode.mp4';", /temporary video storage/i],
    ['a transcode job', 'await ffmpeg(input, output);', /transcod|ffmpeg/i],
    [
      'an adaptive-streaming manifest',
      "const manifest = 'https://cdn/x.m3u8';",
      /adaptive streaming manifest/i,
    ],
    ['a processing worker', "const pool = new WorkerPool({ size: 4 });", /worker/i],
    ['a node worker thread', "import { Worker } from 'node:worker_threads';", /worker/i],
    ['a video proxy', "const videoProxy = createProxy('/video');", /proxy/i],
    ['a video relay', 'function relayVideo() {}', /relay/i],
    ['a video rehost', 'function rehostVideo() {}', /rehost/i],
    ['a server-side fetch of the source', 'await fetch(videoSource);', /fetch/i],
  ] as const;

  for (const [label, source, expected] of catches) {
    it(`catches ${label}`, () => {
      const violations = findVideoPipelineViolations(source);

      expect(violations.length).toBeGreaterThan(0);
      expect(violations.join(' ')).toMatch(expected);
    });
  }

  it('does not catch the poster and banner image upload', () => {
    const source = `
      const form = await request.formData();
      const file = form.get('file');
      const uploadRequestSchema = z.object({ kind: z.enum(['poster', 'banner']) });
      app.post('/admin/api/media', uploadHandler);
    `;

    expect(findVideoPipelineViolations(source)).toEqual([]);
  });

  it('does not catch prose that explains the absence of a pipeline', () => {
    const source = `
      // The server never transcodes, proxies, relays, or rehosts a video.
      // There is no staging directory and no temp video storage.
      // Multipart uploads are only used for poster and banner artwork.
    `;

    expect(findVideoPipelineViolations(source)).toEqual([]);
  });

  it('does not catch the application proxy that sets the security headers', () => {
    const source = `
      export function proxy(request: NextRequest): NextResponse {
        return NextResponse.next();
      }
    `;

    expect(findVideoPipelineViolations(source)).toEqual([]);
  });
});
