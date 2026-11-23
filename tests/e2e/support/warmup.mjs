// Route warm-up for the end-to-end suite.
//
// The E2E launcher runs `next dev`. A development server compiles a route the
// first time it is requested, and on a slow filesystem that compile can take
// longer than a test's own timeout. The failure looked like a product defect
// — a test that navigated to a page which never appeared — while the server
// was in fact still compiling it.
//
// The warm-up pays that compile cost before the first test runs, so the suite
// measures the application and not the development server's cold start.
//
// Every request is a plain GET of a route that already exists. A request that
// redirects (an anonymous administrator request) or answers 404 (a route
// parameter that does not exist) still compiles the route, so the warm-up
// neither needs a session nor creates any data.

const DEFAULT_CONCURRENCY = 6;

/** A UUID-shaped identifier used to compile the dynamic routes. */
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

/**
 * The routes the suite exercises.
 *
 * Static routes are listed exactly. Dynamic routes use a placeholder
 * identifier: the route still compiles, and the placeholder cannot match a
 * real row.
 */
export const WARMUP_PATHS = [
  // Public site.
  '/',
  '/drama',
  '/movie',
  '/categories',
  '/platforms',
  '/trending',
  '/bookmark',
  '/help',
  '/information/terms',
  '/information/privacy',
  '/information/community-guidelines',
  '/information/copyright-dmca',
  '/information/about',
  '/information/contact',

  // Authentication.
  '/auth/signin',
  '/vault-7x9k-console',

  // Administration.
  '/admin',
  '/admin/users',
  '/admin/categories',
  '/admin/platforms',
  '/admin/dramas',
  '/admin/dramas/new',
  '/admin/movies',
  '/admin/publication',
  '/admin/trash',
  '/admin/roles',
  `/admin/dramas/${PLACEHOLDER_ID}`,
  `/admin/dramas/${PLACEHOLDER_ID}/edit`,
  `/admin/dramas/${PLACEHOLDER_ID}/convert`,
  `/admin/dramas/${PLACEHOLDER_ID}/convert-to-movie`,
  `/admin/dramas/${PLACEHOLDER_ID}/similar-dramas`,

  // Viewer playback.
  `/drama/${PLACEHOLDER_ID}/warmup/episode/${PLACEHOLDER_ID}`,

  // REST endpoints.
  '/public/api/dramas?page=1&pageSize=2',
  '/admin/api/roles',
  '/admin/api/information-pages',
  `/admin/api/similar-dramas/candidates?dramaId=${PLACEHOLDER_ID}&search=a`,
];

/**
 * Request one route.
 *
 * The status code does not matter: a redirect and a not-found response both
 * prove that the route was compiled. Only a transport failure is reported.
 */
async function warmupPath(baseUrl, path) {
  try {
    await fetch(`${baseUrl}${path}`, {
      redirect: 'manual',
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(`[e2e] Could not warm ${path}: ${message}`);
  }
}

/**
 * Warm every route in the list.
 *
 * @param {string} baseUrl The base URL of the running application.
 * @param {readonly string[]} [paths] The routes to warm.
 * @param {number} [concurrency] How many requests may run at the same time.
 */
export async function warmupRoutes(baseUrl, paths = WARMUP_PATHS, concurrency = DEFAULT_CONCURRENCY) {
  const startedAt = Date.now();
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < paths.length) {
      const index = nextIndex;
      nextIndex += 1;

      await warmupPath(baseUrl, paths[index]);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, paths.length) }, () => worker());

  await Promise.all(workers);

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`[e2e] Warmed ${paths.length} route(s) in ${seconds}s.`);
}
