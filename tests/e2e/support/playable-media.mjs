// A playable media fixture for the browser tests.
//
// The administrator's preview only accepts a source the *browser* proved to
// play: the application server never fetches the URL, so the test has to
// serve something the browser can actually decode.
//
// The file is a one-second silent WAV. The browser's media stack decodes PCM
// WAV natively, so it behaves like a media file an administrator could
// preview: it has a duration, it plays, and it can be seeked.
//
// The host answers the way a real media host does: a `206` with the requested
// slice and a `Content-Range` header, plus `Access-Control-Allow-Origin`. The
// preview requests the media with `crossorigin="anonymous"`, exactly like the
// viewer's player, so the browser refuses a response without CORS headers —
// and without range support the browser cannot seek, which the preview rightly
// rejects as well.

/**
 * Build a one-second silent WAV file.
 *
 * @returns {Buffer} the file's bytes
 */
export function createPlayableMedia() {
  const sampleRate = 8000;
  const seconds = 1;
  const bytesPerSample = 1;
  const dataSize = sampleRate * seconds * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(8 * bytesPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // 8-bit PCM silence is the midpoint of the range.
  buffer.fill(128, 44);

  return buffer;
}

/**
 * Serve a playable media file for one URL pattern.
 *
 * @param {import('@playwright/test').Page} page the page to intercept
 * @param {string} pattern a Playwright URL glob, e.g. `**\/e2e\/replacement.mp4`
 * @returns {Promise<{ sawCorsRequest: () => boolean }>} whether the browser
 *   made a CORS-enabled request for the media
 */
export async function servePlayableMedia(page, pattern) {
  let sawCorsRequest = false;

  await page.route(pattern, async route => {
    const body = createPlayableMedia();
    const requestHeaders = route.request().headers();
    const range = requestHeaders['range'];

    // A CORS-enabled media request carries an `Origin` header. A plain
    // no-CORS request does not.
    sawCorsRequest = sawCorsRequest || requestHeaders['origin'] !== undefined;

    const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;

    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match[2] ? Number.parseInt(match[2], 10) : body.length - 1;

      await route.fulfill({
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Content-Range': `bytes ${start}-${end}/${body.length}`,
          'Content-Type': 'audio/wav',
        },
        body: body.subarray(start, end + 1),
      });

      return;
    }

    await route.fulfill({
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'audio/wav',
      },
      body,
    });
  });

  return { sawCorsRequest: () => sawCorsRequest };
}
