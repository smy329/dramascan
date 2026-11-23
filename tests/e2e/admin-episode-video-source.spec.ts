import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';
import {
  insertPlaybackFailure,
  readEpisodeVideoSource,
  removeDrama,
  seedDrama,
} from './support/drama-fixture.mjs';
import { servePlayableMedia } from './support/playable-media.mjs';

/**
 * Browser coverage for the administrator side of the direct-video workflow.
 *
 * Three things are checked against the real application, the real database,
 * and a real browser:
 *
 *  1. Subtitle tracks are managed per episode: an administrator adds a track,
 *     sees it listed, and removes it.
 *  2. The video source of an existing episode can only be replaced through the
 *     preview-then-confirm path. The browser has to prove that the new URL
 *     plays before the confirmation is offered, and the confirmation has to
 *     state what the replacement does to viewer progress.
 *  3. Reported playback failures are visible to an administrator.
 *
 * Nothing is mocked. The one substitution is the media file itself: the test
 * serves a tiny generated audio file instead of a real MP4, because the point
 * of the test is the workflow, not the codec. The browser still has to decode
 * it, report that it is playing, and answer a seek before the administrator
 * is allowed to replace the source.
 */

const ORIGINAL_SOURCE = 'https://media.example.com/e2e/original.mp4';
const REPLACEMENT_SOURCE = 'https://media.example.com/e2e/replacement.mp4';
const SUBTITLE_SOURCE = 'https://subs.example.com/e2e/episode.en.vtt';

/** Seed an administrator session and put its cookie in the browser. */
async function signIn(context: BrowserContext) {
  const session = await adminSession.seed({ email: 'e2e-video-source-admin@example.com' });

  await context.addCookies([
    {
      name: session.cookieName,
      value: session.cookieValue,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  return session;
}

/** Expand the episode row so its management panels are visible. */
async function openEpisode(page: Page, title: string): Promise<void> {
  const row = page.getByRole('row', { name: new RegExp(title) });

  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Edit' }).click();
}

test.describe('admin episode video source', () => {
  test('manages the subtitle tracks of an episode', async ({ context, page }) => {
    const session = await signIn(context);
    const drama = await seedDrama({
      episodesPerSeason: 1,
      episodeVideoSource: ORIGINAL_SOURCE,
    });

    try {
      await page.goto(`/admin/dramas/${drama.id}`);
      await openEpisode(page, 'Episode 1.1');

      const subtitles = page.getByRole('region', { name: /Subtitles for Episode 1.1/ });

      await subtitles.getByLabel('Language').fill('en');
      await subtitles.getByLabel('Label').fill('English');
      await subtitles.getByLabel('Format').selectOption('vtt');
      await subtitles.getByLabel('Source URL').fill(SUBTITLE_SOURCE);
      await subtitles.getByLabel('Default track').check();
      await subtitles.getByRole('button', { name: 'Add subtitle track' }).click();

      // The track is listed with its label, its language, and the fact that
      // it is the default track.
      await expect(subtitles.getByText('English', { exact: true })).toBeVisible();
      await expect(subtitles.getByText('en', { exact: true })).toBeVisible();
      await expect(subtitles.getByText('Default', { exact: true })).toBeVisible();

      // The stored track is what the player will read.
      await expect(subtitles.getByText(SUBTITLE_SOURCE)).toBeVisible();

      await subtitles.getByRole('button', { name: 'Remove the English subtitle track' }).click();

      await expect(subtitles.getByText('English', { exact: true })).toHaveCount(0);
    } finally {
      await removeDrama(drama);
      await adminSession.remove(session.userId);
    }
  });

  test('replaces the video source only after the preview verified it and the administrator confirmed', async ({
    context,
    page,
  }) => {
    const session = await signIn(context);
    const drama = await seedDrama({
      episodesPerSeason: 1,
      episodeVideoSource: ORIGINAL_SOURCE,
    });
    const episodeId = drama.episodeIds[0]!;

    try {
      const media = await servePlayableMedia(page, '**/e2e/replacement.mp4');
      await page.goto(`/admin/dramas/${drama.id}`);
      await openEpisode(page, 'Episode 1.1');

      const videoSource = page.getByRole('region', { name: /Video source for Episode 1.1/ });

      // The stored source is shown, and the replacement is a separate flow.
      await expect(videoSource.getByText(ORIGINAL_SOURCE)).toBeVisible();

      const replaceButton = videoSource.getByRole('button', { name: 'Replace video source' });

      // Without a URL there is nothing to replace.
      await expect(replaceButton).toBeDisabled();

      await videoSource.getByLabel('New video source URL').fill(REPLACEMENT_SOURCE);

      // The browser has to prove that the new URL plays. Only then does the
      // administrator get the chance to confirm the replacement.
      await expect(videoSource.getByText(/Playback verified/i)).toBeVisible({ timeout: 20_000 });
      await expect(replaceButton).toBeEnabled();

      // The preview tested the source under the same conditions the viewer's
      // player will use: a CORS-enabled request. A host without CORS headers
      // would have failed the preview instead of passing it.
      expect(media.sawCorsRequest()).toBe(true);

      await replaceButton.click();

      const dialog = page.locator('[data-slot="alert-dialog-content"]');

      await expect(dialog).toBeVisible();
      // The confirmation states what the replacement does to viewer progress
      // and what it keeps.
      await expect(dialog.getByText(/playback progress/i)).toBeVisible();
      await expect(dialog.getByText(/watch history/i)).toBeVisible();
      await expect(dialog.getByText(REPLACEMENT_SOURCE)).toBeVisible();

      await dialog.getByRole('button', { name: 'Replace source' }).click();

      // The replacement is stored.
      await expect
        .poll(async () => readEpisodeVideoSource(episodeId), { timeout: 15_000 })
        .toBe(REPLACEMENT_SOURCE);
    } finally {
      await removeDrama(drama);
      await adminSession.remove(session.userId);
    }
  });

  test('shows the playback failures reported for the drama', async ({ context, page }) => {
    const session = await signIn(context);
    const drama = await seedDrama({
      episodesPerSeason: 1,
      episodeVideoSource: ORIGINAL_SOURCE,
    });
    const episodeId = drama.episodeIds[0]!;

    try {
      await insertPlaybackFailure(episodeId, {
        reason: 'cors',
        detail: 'The host does not allow cross-origin playback.',
      });

      await page.goto(`/admin/dramas/${drama.id}`);

      const failures = page.getByRole('region', { name: 'Reported playback failures' });

      await expect(failures).toBeVisible();
      await expect(failures.getByText('Episode 1.1')).toBeVisible();
      await expect(failures.getByText(/cross-origin/i)).toBeVisible();
    } finally {
      await removeDrama(drama);
      await adminSession.remove(session.userId);
    }
  });
});
