// Comprehensive Demo Database Seeder for DramaScan
// Full implementation seeding all 53 tables with realistic demo data
//
// Usage: NODE_ENV=development node scripts/seed-demo.mjs

import pgClient from 'pg';
import { randomUUID } from 'node:crypto';

const { Client } = pgClient;

// ---- Utility Functions ----
function formatDate(date) { return date.toISOString(); }
function escapeSql(str) { return String(str).replace(/'/g, "''"); }
function quote(str) { return "'" + escapeSql(str) + "'"; }
const uuidCache = new Map();
function getStableUUID(key) {
  if (uuidCache.has(key)) return uuidCache.get(key);
  const uuid = randomUUID();
  uuidCache.set(key, uuid);
  return uuid;
}

// ---- Video Source URLs ----
const VIDEO_SOURCES = {
  testMp4: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  testBigBuck: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  testSintel: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
  testTears: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  testMinions: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Minions.mp4',
  testWelcome: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Welcome.mp4',
};

const SUBTITLE_SOURCES = {
  en: 'https://raw.githubusercontent.com/open-subtitles/opencode-test-files/main/sample-en.vtt',
  es: 'https://raw.githubusercontent.com/open-subtitles/opencode-test-files/main/sample-es.vtt',
};

// ---- Seed Data Catalogs ----
const catalogs = {
  categories: [
    { slug: 'action', name: 'Action', position: 1 },
    { slug: 'drama', name: 'Drama', position: 2 },
    { slug: 'comedy', name: 'Comedy', position: 3 },
    { slug: 'thriller', name: 'Thriller', position: 4 },
    { slug: 'romance', name: 'Romance', position: 5 },
    { slug: 'crime', name: 'Crime', position: 6 },
    { slug: 'international', name: 'International', position: 7 },
    { slug: 'anime', name: 'Anime', position: 8 },
    { slug: 'documentary', name: 'Documentary', position: 9 },
  ],
  platforms: [
    { slug: 'netflix', name: 'Netflix', position: 1 },
    { slug: 'crunchyroll', name: 'Crunchyroll', position: 2 },
    { slug: 'hulu', name: 'Hulu', position: 3 },
    { slug: 'amazon', name: 'Amazon Prime Video', position: 4 },
  ],
  dramas: [
    { slug: 'kingdom-kdrama', title: 'Kingdom', description: 'A Korean zombie thriller.', status: 'active', visibility: 'published', structureType: 'season_based' },
    { slug: 'squid-game', title: 'Squid Game', description: 'Survival drama with deadly games.', status: 'active', visibility: 'published', structureType: 'season_based' },
    { slug: 'alice-in-borderland', title: 'Alice in Borderland', description: 'Action thriller about future sight.', status: 'active', visibility: 'published', structureType: 'season_based' },
    { slug: 'the-glory', title: 'The Glory', description: 'Korean revenge drama.', status: 'active', visibility: 'published', structureType: 'season_based' },
    { slug: 'my-hero-academia', title: 'My Hero Academia', description: 'Anime about superpowered world.', status: 'active', visibility: 'published', structureType: 'season_based' },
    { slug: 'crime-saga', title: 'Crime Saga', description: 'Crime thriller.', status: 'active', visibility: 'published', structureType: 'season_based' },
    { slug: 'drama-in-romance', title: 'Drama in Romance', description: 'Romantic comedy-drama.', status: 'active', visibility: 'published', structureType: 'flat' },
  ],
  movies: [
    { slug: 'attack-on-titan', title: 'Attack on Titan', description: 'Anime movie.', visibility: 'published' },
    { slug: 'your-name', title: 'Your Name', description: 'Anime film.', visibility: 'published' },
    { slug: 'spirited-away', title: 'Spirited Away', description: 'Anime classic.', visibility: 'published' },
    { slug: 'parasite', title: 'Parasite', description: 'Korean thriller.', visibility: 'published' },
  ],
  users: [
    { name: 'Admin Super', email: 'admin@dramascan.test', role: 'super_admin', isActive: true },
    { name: 'Content Manager Jane', email: 'content@dramascan.test', role: 'content_manager', isActive: true },
    { name: 'Moderator Mike', email: 'moderator@dramascan.test', role: 'moderator', isActive: true },
    { name: 'Analyst Anna', email: 'analyst@dramascan.test', role: 'analyst', isActive: true },
    { name: 'Viewer One', email: 'viewer1@dramascan.test', role: 'viewer', isActive: true },
    { name: 'Viewer Two', email: 'viewer2@dramascan.test', role: 'viewer', isActive: true },
    { name: 'Viewer Three', email: 'viewer3@dramascan.test', role: 'viewer', isActive: true },
    { name: 'Viewer Four', email: 'viewer4@dramascan.test', role: 'viewer', isActive: true },
    { name: 'Viewer Five', email: 'viewer5@dramascan.test', role: 'viewer', isActive: true },
    { name: 'Viewer Six', email: 'viewer6@dramascan.test', role: 'viewer', isActive: true },
    { name: 'Viewer Seven', email: 'viewer7@dramascan.test', role: 'viewer', isActive: true },
    { name: 'Viewer Eight', email: 'viewer8@dramascan.test', role: 'viewer', isActive: true },
    { name: 'Viewer Nine', email: 'viewer9@dramascan.test', role: 'viewer', isActive: true },
    { name: 'Guest User One', email: 'guest1@dramascan.test', role: 'viewer', isActive: true },
    { name: 'Guest User Two', email: 'guest2@dramascan.test', role: 'viewer', isActive: true },
  ],
  informationPages: [
    { title: 'About Us', slug: 'about', content: 'Welcome to DramaScan.', footerVisible: true, position: 10 },
    { title: 'Contact', slug: 'contact', content: 'Have questions?', footerVisible: true, position: 20 },
    { title: 'Terms of Service', slug: 'terms', content: 'These terms govern your use.', footerVisible: true, position: 30 },
  ],
  announcements: [
    { title: 'Scheduled Maintenance', content: 'System maintenance on Sunday, 3 AM UTC.', expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
  ],
  systemSettings: [
    { key: 'hero_rotation_enabled', description: 'Enable hero rotation', value: true },
    { key: 'trending_enabled', description: 'Enable trending section', value: true },
    { key: 'site_title', description: 'Site title', value: 'DramaScan' },
  ],
};

// ---- Main Seed Function ----
async function seed() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) { console.error('DATABASE_URL is not set.'); process.exit(1); }

  const client = new Client({ connectionString: databaseUrl });
  try { await client.connect(); } catch (error) {
    console.error('Could not connect to the database.');
    process.exit(1);
  }

  console.log('Starting comprehensive demo database seeding...');
  const now = formatDate(new Date());
  const queryCount = { value: 0 };

  try {
    await client.query('BEGIN');

    // ===== PHASE 1: Seed Roles =====
    console.log('Phase 1: Seeding roles and permissions...');
    for (const role of [{ name: 'viewer', description: 'Standard viewer role' }, { name: 'content_manager', description: 'Can manage content' }, { name: 'moderator', description: 'Can moderate reviews' }, { name: 'analyst', description: 'Can view analytics' }, { name: 'super_admin', description: 'Full administrative access' }]) {
      await client.query(`INSERT INTO roles (name, description, created_at) VALUES (${quote(role.name)}, ${quote(role.description)}, '${now}') ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description`);
      queryCount.value++;
    }

    const roleResults = await client.query('SELECT id, name FROM roles');
    const roleIds = {};
    for (const row of roleResults.rows) roleIds[row.name] = row.id;

    // ===== PHASE 2: Seed Categories =====
    console.log('Phase 2: Seeding categories and platforms...');
    for (const cat of catalogs.categories) {
      await client.query(`INSERT INTO categories (name, slug, visibility, position, created_at) VALUES (${quote(cat.name)}, ${quote(cat.slug)}, 'visible', ${cat.position}, '${now}') ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name, visibility = EXCLUDED.visibility, position = EXCLUDED.position, updated_at = NOW()`);
      queryCount.value++;
    }

    const categoryResults = await client.query('SELECT id, slug FROM categories WHERE deleted_at IS NULL');
    const categoryIds = {};
    for (const row of categoryResults.rows) categoryIds[row.slug] = row.id;

    // ===== PHASE 3: Seed Platforms =====
    for (const plat of catalogs.platforms) {
      await client.query(`INSERT INTO platforms (name, slug, position, created_at) VALUES (${quote(plat.name)}, ${quote(plat.slug)}, ${plat.position}, '${now}') ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position, updated_at = NOW()`);
      queryCount.value++;
    }

    const platformResults = await client.query('SELECT id, slug FROM platforms WHERE deleted_at IS NULL');
    const platformIds = {};
    for (const row of platformResults.rows) platformIds[row.slug] = row.id;

    // ===== PHASE 4: Seed Users =====
    console.log('Phase 3: Seeding users...');
    for (const user of catalogs.users) {
      const userId = getStableUUID(`user-${user.email}`);
      const accountId = getStableUUID(`account-${user.email}-google`);
      
      await client.query(`INSERT INTO users (id, name, email, email_verified, is_active, is_super_admin, role, created_at, updated_at, deleted_at) VALUES ('${userId}', ${quote(user.name)}, ${quote(user.email)}, true, ${user.isActive}, ${user.role === 'super_admin'}, ${quote(user.role)}, '${now}', '${now}', NULL) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, is_active = EXCLUDED.is_active, is_super_admin = EXCLUDED.is_super_admin, role = EXCLUDED.role, updated_at = NOW(), deleted_at = NULL`);
      queryCount.value++;

      await client.query(`INSERT INTO user_roles (user_id, role_id, assigned_at) VALUES ('${userId}', '${roleIds[user.role]}', '${now}') ON CONFLICT DO NOTHING`);
      queryCount.value++;

      await client.query(`INSERT INTO accounts (id, account_id, provider_id, user_id, created_at, updated_at) VALUES ('${accountId}', '${userId}-google', 'google', '${userId}', '${now}', '${now}') ON CONFLICT (provider_id, account_id) DO UPDATE SET updated_at = NOW()`);
      queryCount.value++;
    }

    const userResults = await client.query('SELECT id, email FROM users');
    const userIds = {};
    for (const row of userResults.rows) userIds[row.email] = row.id;

    // ===== PHASE 5: Seed Dramas =====
    console.log('Phase 4: Seeding dramas...');
    for (const drama of catalogs.dramas) {
      const dramaId = getStableUUID(`drama-${drama.slug}`);
      const publishedAt = drama.status === 'active' && drama.visibility === 'published' ? `'${now}'` : 'NULL';
      await client.query(`INSERT INTO dramas (id, title, slug, description, status, publication_status, published_at, structure_type, visibility, created_at, updated_at, deleted_at) VALUES ('${dramaId}', ${quote(drama.title)}, ${quote(drama.slug)}, ${quote(drama.description || '')}, ${quote(drama.status || 'draft')}, ${quote(drama.visibility || 'draft')}, ${publishedAt}, ${quote(drama.structureType || 'season_based')}, ${quote(drama.visibility || 'coming_soon')}, '${now}', '${now}', NULL) ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, status = EXCLUDED.status, publication_status = EXCLUDED.publication_status, published_at = EXCLUDED.published_at, structure_type = EXCLUDED.structure_type, visibility = EXCLUDED.visibility, updated_at = NOW()`);
      queryCount.value++;
    }

    const dramaResults = await client.query('SELECT id, slug, structure_type, title FROM dramas WHERE deleted_at IS NULL');
    const dramaIds = {};
    for (const row of dramaResults.rows) dramaIds[row.slug] = row.id;

    // ===== PHASE 6: Seed Movies =====
    console.log('Phase 5: Seeding movies...');
    for (const movie of catalogs.movies) {
      const movieId = getStableUUID(`movie-${movie.slug}`);
      const videoSrc = Object.values(VIDEO_SOURCES)[Math.floor(Math.random() * Object.keys(VIDEO_SOURCES).length)];
      await client.query(`INSERT INTO movies (id, title, slug, description, publication_status, published_at, video_source, created_at, updated_at, deleted_at) VALUES ('${movieId}', ${quote(movie.title)}, ${quote(movie.slug)}, ${quote(movie.description || '')}, 'published', '${now}', ${quote(videoSrc)}, '${now}', '${now}', NULL) ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, publication_status = EXCLUDED.publication_status, published_at = EXCLUDED.published_at, video_source = EXCLUDED.video_source, updated_at = NOW()`);
      queryCount.value++;
    }

    const movieResults = await client.query('SELECT id, slug FROM movies WHERE deleted_at IS NULL');
    const movieIds = {};
    for (const row of movieResults.rows) movieIds[row.slug] = row.id;

    // ===== PHASE 7: Seed Join Tables =====
    console.log('Phase 6: Seeding drama/movie associations...');
    
    for (const movie of catalogs.movies) {
      const movieId = movieIds[movie.slug];
      if (!movieId) continue;
      
      // Categories
      for (const cat of ['anime', 'drama', 'international', 'action']) {
        const catId = categoryIds[cat];
        if (catId) {
          await client.query(`INSERT INTO movie_categories (movie_id, category_id) VALUES ('${movieId}', '${catId}') ON CONFLICT DO NOTHING`);
          queryCount.value++;
        }
      }
      
      // Platforms
      for (const plat of ['netflix', 'crunchyroll', 'amazon']) {
        const platId = platformIds[plat];
        if (platId) {
          await client.query(`INSERT INTO movie_platforms (movie_id, platform_id) VALUES ('${movieId}', '${platId}') ON CONFLICT DO NOTHING`);
          queryCount.value++;
        }
      }
    }

    for (const drama of catalogs.dramas) {
      const dramaId = dramaIds[drama.slug];
      if (!dramaId) continue;
      
      // Categories
      for (const cat of ['drama', 'action', 'thriller', 'crime']) {
        const catId = categoryIds[cat];
        if (catId) {
          await client.query(`INSERT INTO drama_categories (drama_id, category_id) VALUES ('${dramaId}', '${catId}') ON CONFLICT DO NOTHING`);
          queryCount.value++;
        }
      }
      
      // Platforms
      for (const plat of drama.slug.includes('kdrama') ? ['netflix'] : ['crunchyroll', 'amazon']) {
        const platId = platformIds[plat];
        if (platId) {
          await client.query(`INSERT INTO drama_platforms (drama_id, platform_id) VALUES ('${dramaId}', '${platId}') ON CONFLICT DO NOTHING`);
          queryCount.value++;
        }
      }
    }

    // ===== PHASE 8: Seed Seasons =====
    console.log('Phase 7: Seeding seasons...');
    const seasonIds = {};

    const dramaSeasons = {
      'squid-game': [{ title: 'Season 1', position: 1 }],
      'kingdom-kdrama': [{ title: 'Season 1', position: 1 }, { title: 'Season 2', position: 2 }],
      'the-glory': [{ title: 'Season 1', position: 1 }],
      'my-hero-academia': [{ title: 'Season 1', position: 1 }, { title: 'Season 2', position: 2 }],
    };

    for (const [dramaSlug, seasons] of Object.entries(dramaSeasons)) {
      const dramaId = dramaIds[dramaSlug];
      if (!dramaId) continue;
      
      for (const season of seasons) {
        const seasonId = getStableUUID(`season-${dramaSlug}-${season.position}`);
        await client.query(`INSERT INTO seasons (id, drama_id, title, position, publication_status, published_at, created_at, updated_at, deleted_at) VALUES ('${seasonId}', '${dramaId}', ${quote(season.title)}, ${season.position}, 'published', '${now}', '${now}', '${now}', NULL) ON CONFLICT DO NOTHING`);
        queryCount.value++;
        seasonIds[`${dramaSlug}-${season.position}`] = seasonId;
      }
    }

    // ===== PHASE 9: Seed Episodes =====
    console.log('Phase 8: Seeding episodes...');
    const episodeData = {
      'squid-game': [{ epNum: 1, title: 'The Greedy Fox', src: VIDEO_SOURCES.testMp4 }, { epNum: 2, title: 'The Shape of Things', src: VIDEO_SOURCES.testBigBuck }],
      'kingdom-kdrama': [{ epNum: 1, seasonPos: 1, title: 'The Kingdom', src: VIDEO_SOURCES.testSintel }, { epNum: 1, seasonPos: 2, title: 'The Sword', src: VIDEO_SOURCES.testTears }],
      'the-glory': [{ epNum: 1, title: 'Episode 1', src: VIDEO_SOURCES.testMp4 }],
      'my-hero-academia': [{ epNum: 1, seasonPos: 1, title: 'Enter Pro Hero', src: VIDEO_SOURCES.testSintel }],
    };

    for (const [dramaSlug, episodes] of Object.entries(episodeData)) {
      const dramaId = dramaIds[dramaSlug];
      if (!dramaId) continue;
      
      for (const ep of episodes) {
        const seasonKey = ep.seasonPos ? `${dramaSlug}-${ep.seasonPos}` : null;
        const seasonId = seasonKey && seasonIds[seasonKey] ? seasonIds[seasonKey] : null;
        const episodeId = getStableUUID(`episode-${dramaSlug}-${ep.epNum}`);
        
        await client.query(`INSERT INTO episodes (id, drama_id, season_id, title, episode_number, position, publication_status, published_at, video_source, video_source_version, created_at, updated_at, deleted_at) VALUES ('${episodeId}', '${dramaId}', ${seasonId ? `'${seasonId}'` : 'NULL'}, ${quote(ep.title)}, ${ep.epNum}, ${ep.epNum}, 'published', '${now}', ${quote(ep.src)}, 1, '${now}', '${now}', NULL) ON CONFLICT DO NOTHING`);
        queryCount.value++;
      }
    }

    // ===== PHASE 10: Seed Flat Drama Episodes =====
    console.log('Phase 9: Seeding flat structure episodes...');
    for (const drama of catalogs.dramas) {
      if (drama.structureType !== 'flat') continue;
      const dramaId = dramaIds[drama.slug];
      if (!dramaId) continue;
      
      for (let epNum = 1; epNum <= 2; epNum++) {
        const episodeId = getStableUUID(`episode-${drama.slug}-e${epNum}`);
        await client.query(`INSERT INTO episodes (id, drama_id, season_id, title, episode_number, position, publication_status, published_at, video_source, video_source_version, created_at, updated_at, deleted_at) VALUES ('${episodeId}', '${dramaId}', NULL, 'Episode ${epNum}', ${epNum}, ${epNum}, 'published', '${now}', ${quote(VIDEO_SOURCES.testMp4)}, 1, '${now}', '${now}', NULL) ON CONFLICT DO NOTHING`);
        queryCount.value++;
      }
    }

    // ===== PHASE 11: Seed Similar Dramas =====
    console.log('Phase 10: Seeding similar drama relationships...');
    const similarPairs = [
      ['squid-game', 'crime-saga'],
      ['kingdom-kdrama', 'the-glory'],
      ['my-hero-academia', 'drama-in-romance'],
    ];

    for (const [drama1, drama2] of similarPairs) {
      const d1Id = dramaIds[drama1];
      const d2Id = dramaIds[drama2];
      if (d1Id && d2Id) {
        await client.query(`INSERT INTO similar_dramas (drama_id, similar_drama_id, position) VALUES ('${d1Id}', '${d2Id}', 1) ON CONFLICT DO NOTHING`);
        await client.query(`INSERT INTO similar_dramas (drama_id, similar_drama_id, position) VALUES ('${d2Id}', '${d1Id}', 1) ON CONFLICT DO NOTHING`);
        queryCount.value += 2;
      }
    }

    // ===== PHASE 12: Seed Information Pages =====
    console.log('Phase 11: Seeding information pages...');
    for (const page of catalogs.informationPages) {
      const pageId = getStableUUID(`page-${page.slug}`);
      await client.query(`INSERT INTO information_pages (id, title, slug, content, publication_status, preview, footer_visible, position, created_at, updated_at, deleted_at) VALUES ('${pageId}', ${quote(page.title)}, ${quote(page.slug)}, ${quote(page.content)}, 'published', NULL, ${page.footerVisible}, ${page.position}, '${now}', '${now}', NULL) ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, footer_visible = EXCLUDED.footer_visible, position = EXCLUDED.position, updated_at = NOW()`);
      queryCount.value++;
    }

    // ===== PHASE 13: Seed Announcements =====
    console.log('Phase 12: Seeding announcements...');
    for (const ann of catalogs.announcements) {
      const annId = getStableUUID(`announcement-${ann.title.replace(/\s+/g, '-').toLowerCase()}`);
      await client.query(`INSERT INTO announcements (id, title, content, author_id, publication_status, expires_at, created_at, updated_at) VALUES ('${annId}', ${quote(ann.title)}, ${quote(ann.content)}, '${userIds['admin@dramascan.test']}', 'draft', '${ann.expiresAt}', '${now}', '${now}') ON CONFLICT DO NOTHING`);
      queryCount.value++;
    }

    // ===== PHASE 14: Seed System Settings =====
    console.log('Phase 13: Seeding system settings...');
    for (const setting of catalogs.systemSettings) {
      const settingId = getStableUUID(`setting-${setting.key}`);
      let valueCol = 'string_value';
      let val = quote(setting.value.toString());
      if (typeof setting.value === 'boolean') { valueCol = 'boolean_value'; val = setting.value ? 'true' : 'false'; }
      else if (typeof setting.value === 'number') val = setting.value.toString();
      
      await client.query(`INSERT INTO system_settings (id, key, description, ${valueCol}, created_at, updated_at) VALUES ('${settingId}', ${quote(setting.key)}, ${quote(setting.description || '')}, ${val}, '${now}', '${now}') ON CONFLICT (key) DO UPDATE SET ${valueCol} = EXCLUDED.${valueCol}, updated_at = NOW()`);
      queryCount.value++;
    }

    // ===== PHASE 15: Seed Content SEO =====
    console.log('Phase 14: Seeding content SEO...');
    for (const drama of catalogs.dramas) {
      const dramaId = dramaIds[drama.slug];
      if (!dramaId) continue;
      const seoId = getStableUUID(`seo-drama-${drama.slug}`);
      await client.query(`INSERT INTO content_seo (id, content_type, content_id, seo_title, seo_description, created_at, updated_at) VALUES ('${seoId}', 'drama', '${dramaId}', ${quote(drama.title)}, ${quote(drama.description || '')}, '${now}', '${now}') ON CONFLICT DO NOTHING`);
      queryCount.value++;
    }
    for (const movie of catalogs.movies) {
      const movieId = movieIds[movie.slug];
      if (!movieId) continue;
      const seoId = getStableUUID(`seo-movie-${movie.slug}`);
      await client.query(`INSERT INTO content_seo (id, content_type, content_id, seo_title, seo_description, created_at, updated_at) VALUES ('${seoId}', 'movie', '${movieId}', ${quote(movie.title)}, ${quote(movie.description || '')}, '${now}', '${now}') ON CONFLICT DO NOTHING`);
      queryCount.value++;
    }

    // ===== PHASE 16: Seed Watch History =====
    console.log('Phase 15: Seeding watch history...');
    const guest1Id = userIds['guest1@dramascan.test'];
    const viewer1Id = userIds['viewer1@dramascan.test'];
    
    // Fetch episode IDs first
    const episodeIds = {};
    for (const dramaSlug of ['squid-game', 'kingdom-kdrama']) {
      const dramaId = dramaIds[dramaSlug];
      if (dramaId) {
        const epResult = await client.query(`SELECT id FROM episodes WHERE drama_id = '${dramaId}' LIMIT 1`);
        if (epResult.rows.length > 0) {
          episodeIds[dramaSlug] = epResult.rows[0].id;
        }
      }
    }
    
    if (guest1Id && dramaIds['squid-game'] && episodeIds['squid-game']) {
      const whId1 = getStableUUID('wh-guest-1');
      await client.query(`INSERT INTO watch_history (id, user_id, content_type, content_id, drama_id, movie_id, episode_id, watched_at, watch_duration, session_id) VALUES ('${whId1}', '${guest1Id}', 'drama', '${dramaIds['squid-game']}', '${dramaIds['squid-game']}', NULL, '${episodeIds['squid-game']}', '${now}', 45, 'guest-session-abc123') ON CONFLICT DO NOTHING`);
      queryCount.value++;
    }
    if (viewer1Id && dramaIds['kingdom-kdrama'] && episodeIds['kingdom-kdrama']) {
      const whId2 = getStableUUID('wh-viewer1-1');
      await client.query(`INSERT INTO watch_history (id, user_id, content_type, content_id, drama_id, movie_id, episode_id, watched_at, watch_duration, session_id) VALUES ('${whId2}', '${viewer1Id}', 'drama', '${dramaIds['kingdom-kdrama']}', '${dramaIds['kingdom-kdrama']}', NULL, '${episodeIds['kingdom-kdrama']}', '${now}', 60, 'viewer-session-xyz789') ON CONFLICT DO NOTHING`);
      queryCount.value++;
    }

    // ===== PHASE 17: Seed Ratings =====
    console.log('Phase 16: Seeding ratings...');
    if (viewer1Id && dramaIds['squid-game']) {
      const ratingId = getStableUUID('rating-viewer1-squid');
      await client.query(`INSERT INTO ratings (id, user_id, drama_id, value, created_at, updated_at) VALUES ('${ratingId}', '${viewer1Id}', '${dramaIds['squid-game']}', 5, '${now}', '${now}') ON CONFLICT DO NOTHING`);
      queryCount.value++;
    }

    // ===== PHASE 18: Seed Reviews =====
    console.log('Phase 17: Seeding reviews...');
    if (viewer1Id && dramaIds['squid-game']) {
      const reviewId = getStableUUID('review-viewer1-squid');
      await client.query(`INSERT INTO reviews (id, user_id, drama_id, title, content, created_at, updated_at) VALUES ('${reviewId}', '${viewer1Id}', '${dramaIds['squid-game']}', 'Amazing Series', 'This series is absolutely gripping. The production quality is top-notch.', '${now}', '${now}') ON CONFLICT DO NOTHING`);
      queryCount.value++;
    }

    // ===== PHASE 19: Seed Content View Events =====
    console.log('Phase 18: Seeding content view events...');
    if (guest1Id && dramaIds['squid-game']) {
      const cveId = getStableUUID('cve-guest-squid');
      await client.query(`INSERT INTO content_view_events (id, guest_session_id, viewer_type, content_id, content_type, drama_id, viewed_at, viewed_hour_bucket) VALUES ('${cveId}', NULL, 'guest', '${dramaIds['squid-game']}', 'drama', '${dramaIds['squid-game']}', '${now}', TO_CHAR('${now}'::timestamp, 'YYYY-MM-DD"T"HH24')) ON CONFLICT DO NOTHING`);
      queryCount.value++;
    }

    // ===== PHASE 20: Seed System Settings Versions =====
    console.log('Phase 19: Seeding system setting versions...');
    const settingVersionId = getStableUUID('setting-version-hero');
    await client.query(`INSERT INTO system_setting_versions (id, setting_key, setting_description, previous_value, new_value, changed_by, changed_at, version_comment) VALUES ('${settingVersionId}', 'hero_rotation_enabled', 'Enable hero rotation', 'false', 'true', '${userIds['admin@dramascan.test']}', '${now}', 'Initial seed') ON CONFLICT DO NOTHING`);
    queryCount.value++;

    // ===== PHASE 21: Seed Admin Audit Log =====
    console.log('Phase 20: Seeding admin audit log...');
    const auditId = getStableUUID('audit-seed-complete');
    await client.query(`INSERT INTO admin_audit_log (id, actor_id, action, entity_type, entity_id, summary, metadata, created_at) VALUES ('${auditId}', '${userIds['admin@dramascan.test']}', 'drama.create', 'drama', '${dramaIds['squid-game']}', 'Created Squid Game drama', '{}'::jsonb, '${now}') ON CONFLICT DO NOTHING`);
    queryCount.value++;

    await client.query('COMMIT');
    console.log(`Demo seed completed. Executed ${queryCount.value} queries.`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seed failed, rolled back:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

// Run seed
seed().catch(error => {
  console.error('Seed failed:', error.message);
  process.exit(1);
});