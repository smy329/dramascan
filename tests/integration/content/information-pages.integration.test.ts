import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for information pages and the public footer link
 * configuration.
 *
 * These tests use the real PostgreSQL test database and the ordered SQL
 * migrations, so they verify the seeded rows, the partial unique slug index,
 * the footer order, and the service-level authorization rules together.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for information-page integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { asc, eq, like, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  getPublishedInformationPage,
  listFooterInformationLinks,
  listInformationPages,
  reorderInformationPages,
  updateInformationPage,
} from '@/modules/content/information-pages';
import { information_pages } from '@/modules/content/schema';
import type { ActorContext } from '@/modules/authorization';
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '@/platform/errors';
import { closePool } from '@/platform/db/pool';

const TEST_SLUG_PREFIX = 'it-info-';
const SEED = 'This page is being prepared.';
const CANONICAL_SLUGS = [
  'terms',
  'privacy',
  'community-guidelines',
  'copyright-dmca',
  'about',
  'contact',
] as const;

const anonymousActor: ActorContext = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

const settingsManagerActor: ActorContext = {
  userId: 'it-info-settings-manager',
  roles: ['settings_manager'],
  isSuperAdmin: false,
  permissions: ['settings.manage'],
};

const readOnlyActor: ActorContext = {
  userId: 'it-info-reader',
  roles: ['reader'],
  isSuperAdmin: false,
  permissions: ['settings.read'],
};

function testSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

async function insertPage(options: {
  slug: string;
  title?: string;
  position?: number | null;
  published?: boolean;
  footerVisible?: boolean | null;
  deletedAt?: Date | null;
  content?: string;
}): Promise<string> {
  const [row] = await db
    .insert(information_pages)
    .values({
      title: options.title ?? options.slug,
      slug: options.slug,
      content: options.content ?? 'Test information page.',
      publication_status: options.published === false ? 'draft' : 'published',
      footer_visible: options.footerVisible === undefined ? true : options.footerVisible,
      position: options.position === undefined ? 100 : options.position,
      deleted_at: options.deletedAt ?? null,
    })
    .returning({ id: information_pages.id });

  if (!row) {
    throw new Error('Test information page insert returned no row.');
  }

  return row.id;
}

async function cleanupTestPages(): Promise<void> {
  await db.delete(information_pages).where(like(information_pages.slug, `${TEST_SLUG_PREFIX}%`));
}

/** The exact seed statement from the applied migration. */
function seedStatement(): string {
  const migration = readFileSync('drizzle/0002_information_page_footer_links.sql', 'utf8');
  const statement = migration
    .split('--> statement-breakpoint')
    .map(part => part.trim())
    .find(part => part.startsWith('INSERT INTO "information_pages"'));

  if (!statement) {
    throw new Error('Could not find the information-page seed statement in migration 0002.');
  }

  return statement;
}

beforeEach(async () => {
  await cleanupTestPages();
});

afterEach(async () => {
  await cleanupTestPages();
});

afterAll(async () => {
  await cleanupTestPages();
  await closePool();
});

describe('seed migration', () => {
  it('creates exactly six published, footer-visible placeholder pages in order', async () => {
    const rows = await db
      .select()
      .from(information_pages)
      .orderBy(asc(information_pages.position));

    const canonical = rows.filter(row =>
      CANONICAL_SLUGS.includes(row.slug as (typeof CANONICAL_SLUGS)[number])
    );

    expect(canonical).toHaveLength(6);
    expect(canonical.map(row => row.slug)).toEqual([...CANONICAL_SLUGS]);
    expect(canonical.map(row => row.position)).toEqual([1, 2, 3, 4, 5, 6]);

    for (const row of canonical) {
      expect(row.publication_status).toBe('published');
      expect(row.footer_visible).toBe(true);
      expect(row.content).toBe(SEED);
      expect(row.deleted_at).toBeNull();
    }
  });

  it('is idempotent and never overwrites administrator-edited content', async () => {
    const marker = `Administrator edit ${randomUUID()}`;

    const [original] = await db
      .select({ id: information_pages.id, content: information_pages.content })
      .from(information_pages)
      .where(eq(information_pages.slug, 'terms'))
      .limit(1);

    expect(original).toBeDefined();

    try {
      await db
        .update(information_pages)
        .set({ content: marker })
        .where(eq(information_pages.id, original!.id));

      await db.execute(sql.raw(seedStatement()));

      const rows = await db
        .select({ id: information_pages.id, content: information_pages.content })
        .from(information_pages)
        .where(eq(information_pages.slug, 'terms'));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(original!.id);
      expect(rows[0]?.content).toBe(marker);
    } finally {
      await db
        .update(information_pages)
        .set({ content: original!.content })
        .where(eq(information_pages.id, original!.id));
    }
  });
});

describe('listFooterInformationLinks (real database)', () => {
  it('returns the six canonical links in position order', async () => {
    const links = await listFooterInformationLinks();
    const canonical = links.filter(link =>
      CANONICAL_SLUGS.includes(link.slug as (typeof CANONICAL_SLUGS)[number])
    );

    expect(canonical.map(link => link.slug)).toEqual([...CANONICAL_SLUGS]);
    expect(canonical[0]?.href).toBe('/information/terms');
  });

  it('obeys administrator ordering and excludes hidden, draft, deleted, and malformed rows', async () => {
    const firstId = await insertPage({
      slug: testSlug('first'),
      title: 'A first test page',
      position: 0,
    });
    const lastId = await insertPage({
      slug: testSlug('last'),
      title: 'Z last test page',
      position: 999,
    });
    const nullPositionId = await insertPage({
      slug: testSlug('null-position'),
      title: 'ZZZ null position',
      position: null,
    });

    const hiddenSlug = testSlug('hidden');
    const nullVisibleSlug = testSlug('null-visible');
    const draftSlug = testSlug('draft');
    const deletedSlug = testSlug('deleted');
    const malformedSlug = 'it-info-Invalid Slug';

    await insertPage({ slug: hiddenSlug, footerVisible: false, position: -1 });
    await insertPage({ slug: nullVisibleSlug, footerVisible: null, position: -2 });
    await insertPage({ slug: draftSlug, published: false, position: -3 });
    await insertPage({
      slug: deletedSlug,
      deletedAt: new Date(),
      position: -4,
    });
    // The database does not constrain slug syntax, so a misconfigured row must
    // still be filtered before it can become a broken public link.
    await insertPage({ slug: malformedSlug, position: -5 });

    const links = await listFooterInformationLinks();
    const ids = links.map(link => link.id);
    const slugs = links.map(link => link.slug);

    expect(ids[0]).toBe(firstId);
    expect(ids).toContain(lastId);
    expect(ids).toContain(nullPositionId);
    expect(ids.at(-1)).toBe(nullPositionId);

    expect(slugs).not.toContain(hiddenSlug);
    expect(slugs).not.toContain(nullVisibleSlug);
    expect(slugs).not.toContain(draftSlug);
    expect(slugs).not.toContain(deletedSlug);
    expect(slugs).not.toContain(malformedSlug);
  });
});

describe('getPublishedInformationPage (real database)', () => {
  it('returns a published page by slug', async () => {
    const page = await getPublishedInformationPage('terms');

    expect(page).toMatchObject({ slug: 'terms', title: 'Terms of Service', content: SEED });
  });

  it.each([
    ['missing', 'it-info-does-not-exist'],
    ['malformed uppercase', 'Terms'],
    ['path traversal', '../terms'],
    ['query text', 'terms?preview=true'],
  ])('returns null for a %s slug', async (_label, slug) => {
    await expect(getPublishedInformationPage(slug)).resolves.toBeNull();
  });

  it('returns null for draft, unpublished, and deleted pages', async () => {
    const draftSlug = testSlug('draft-page');
    const deletedSlug = testSlug('deleted-page');

    await insertPage({ slug: draftSlug, published: false });
    await insertPage({ slug: deletedSlug, deletedAt: new Date() });

    await expect(getPublishedInformationPage(draftSlug)).resolves.toBeNull();
    await expect(getPublishedInformationPage(deletedSlug)).resolves.toBeNull();
  });
});

describe('admin authorization (service level)', () => {
  it('rejects anonymous callers with AuthenticationError', async () => {
    await expect(listInformationPages(anonymousActor, { page: 1, pageSize: 20 })).rejects.toBeInstanceOf(
      AuthenticationError
    );

    await expect(
      updateInformationPage(anonymousActor, '0198f3a2-0000-7000-8000-000000000001', {
        title: 'Nope',
      })
    ).rejects.toBeInstanceOf(AuthenticationError);

    await expect(
      reorderInformationPages(anonymousActor, {
        ids: ['0198f3a2-0000-7000-8000-000000000001'],
      })
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects authenticated callers without settings.manage', async () => {
    await expect(listInformationPages(readOnlyActor, { page: 1, pageSize: 20 })).rejects.toBeInstanceOf(
      AuthorizationError
    );

    await expect(
      updateInformationPage(readOnlyActor, '0198f3a2-0000-7000-8000-000000000001', {
        title: 'Nope',
      })
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      reorderInformationPages(readOnlyActor, {
        ids: ['0198f3a2-0000-7000-8000-000000000001'],
      })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('allows settings.manage to list and update', async () => {
    const id = await insertPage({ slug: testSlug('authorized'), title: 'Before' });

    const listed = await listInformationPages(settingsManagerActor, { page: 1, pageSize: 100 });
    expect(listed.pages.some(page => page.id === id)).toBe(true);

    const updated = await updateInformationPage(settingsManagerActor, id, { title: 'After' });
    expect(updated.title).toBe('After');
  });
});

describe('updateInformationPage (real database)', () => {
  it('persists editable fields and removes the link from the footer when hidden', async () => {
    const id = await insertPage({ slug: testSlug('update'), title: 'Original', position: 0 });

    const updated = await updateInformationPage(settingsManagerActor, id, {
      title: 'Updated title',
      content: 'Updated body',
      publicationStatus: 'draft',
      footerVisible: true,
      position: 4,
    });

    expect(updated).toMatchObject({
      id,
      title: 'Updated title',
      content: 'Updated body',
      publicationStatus: 'draft',
      footerVisible: true,
      position: 4,
    });

    await expect(getPublishedInformationPage(testSlug('update'))).resolves.toBeNull();

    await updateInformationPage(settingsManagerActor, id, {
      publicationStatus: 'published',
      footerVisible: false,
    });

    const links = await listFooterInformationLinks();
    expect(links.some(link => link.id === id)).toBe(false);

    await updateInformationPage(settingsManagerActor, id, { footerVisible: true });
    const visibleLinks = await listFooterInformationLinks();
    expect(visibleLinks.some(link => link.id === id)).toBe(true);
  });

  it('rejects invalid input and unknown ids', async () => {
    const id = await insertPage({ slug: testSlug('invalid-update') });

    await expect(
      updateInformationPage(settingsManagerActor, id, { position: -1 })
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      updateInformationPage(settingsManagerActor, 'not-a-uuid', { title: 'Nope' })
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      updateInformationPage(settingsManagerActor, '0198f3a2-0000-7000-8000-00000000dead', {
        title: 'Nope',
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('reorderInformationPages (real database)', () => {
  it('stores the supplied order in one transaction', async () => {
    const first = await insertPage({ slug: testSlug('reorder-a'), position: 10 });
    const second = await insertPage({ slug: testSlug('reorder-b'), position: 11 });
    const third = await insertPage({ slug: testSlug('reorder-c'), position: 12 });

    const reordered = await reorderInformationPages(settingsManagerActor, {
      ids: [third, first, second],
    });

    expect(reordered.map(page => page.id)).toEqual([third, first, second]);
    expect(reordered.map(page => page.position)).toEqual([1, 2, 3]);

    const stored = await db
      .select({ id: information_pages.id, position: information_pages.position })
      .from(information_pages)
      .where(like(information_pages.slug, `${TEST_SLUG_PREFIX}reorder-%`))
      .orderBy(asc(information_pages.position));

    expect(stored.map(row => row.id)).toEqual([third, first, second]);
  });

  it('rolls back completely when one id does not exist', async () => {
    const first = await insertPage({ slug: testSlug('rollback-a'), position: 10 });
    const second = await insertPage({ slug: testSlug('rollback-b'), position: 11 });

    await expect(
      reorderInformationPages(settingsManagerActor, {
        ids: [second, first, '0198f3a2-0000-7000-8000-00000000dead'],
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    const stored = await db
      .select({ id: information_pages.id, position: information_pages.position })
      .from(information_pages)
      .where(like(information_pages.slug, `${TEST_SLUG_PREFIX}rollback-%`))
      .orderBy(asc(information_pages.position));

    expect(stored).toEqual([
      { id: first, position: 10 },
      { id: second, position: 11 },
    ]);
  });
});

describe('listInformationPages (real database)', () => {
  it('paginates deterministically and exposes drafts to administrators', async () => {
    await insertPage({ slug: testSlug('list-draft'), published: false, position: 21 });
    await insertPage({ slug: testSlug('list-b'), position: 22 });
    await insertPage({ slug: testSlug('list-c'), position: 23 });

    const firstPage = await listInformationPages(settingsManagerActor, { page: 1, pageSize: 2 });
    const secondPage = await listInformationPages(settingsManagerActor, { page: 2, pageSize: 2 });

    expect(firstPage.pages).toHaveLength(2);
    expect(firstPage.total).toBeGreaterThanOrEqual(9);
    expect(firstPage.hasNextPage).toBe(true);
    expect(firstPage.hasPreviousPage).toBe(false);
    expect(secondPage.hasPreviousPage).toBe(true);
    expect(secondPage.pages.map(page => page.id)).not.toEqual(
      firstPage.pages.map(page => page.id)
    );
  });
});
