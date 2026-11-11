// Runs inside every Node.js process that starts the E2E application, via
// NODE_OPTIONS=--require. It is inert unless the E2E launcher sets
// E2E_EXPECTED_DATABASE_NAME.
//
// This is the last line of defence: even if the launcher were bypassed, the
// Next.js server itself refuses to start against anything other than the
// validated test database.

const EXPECTED_DATABASE_NAME = process.env.E2E_EXPECTED_DATABASE_NAME;

if (!EXPECTED_DATABASE_NAME) {
  return;
}

const databaseUrl = process.env.DATABASE_URL;
const actualName = databaseNameFrom(databaseUrl);

if (actualName === null || actualName.length === 0) {
  fail('The E2E server has no usable DATABASE_URL.');
}

if (actualName !== EXPECTED_DATABASE_NAME) {
  fail(
    `The E2E server DATABASE_URL points at "${actualName}", but this run expects ` +
      `"${EXPECTED_DATABASE_NAME}".`
  );
}

if (!actualName.endsWith('_test')) {
  fail(`The E2E server DATABASE_URL must point at a database ending in "_test", got "${actualName}".`);
}

function databaseNameFrom(url) {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return null;
  }

  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(`[e2e] Refusing to start the application server. ${message}`);
  process.exit(1);
}
