/**
 * Safety rails for the integration suite.
 *
 * The app's SQL login is `sa` on an instance that also hosts unrelated databases, so a
 * misconfigured test run could do real damage. These helpers make the suite refuse to
 * start unless it is pointed at a database whose name ends in `_TEST`.
 */

/** Pull the database name out of a Prisma SQL Server URL (`...;database=NAME;...`). */
export function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:^|;)\s*(?:database|initial catalog)\s*=\s*([^;]+)/i);
  return m ? m[1].trim() : null;
}

export const TEST_DB_NAME = 'RFQ_TEST';

/**
 * The URL the tests use: `TEST_DATABASE_URL` if set (CI), otherwise the developer's
 * `DATABASE_URL` with the database swapped for RFQ_TEST — same server and credentials.
 */
export function deriveTestUrl(env: Record<string, string | undefined>): string {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  const base = env.DATABASE_URL;
  if (!base) throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL in apps/api/.env) to run the integration tests.');
  if (!databaseName(base)) throw new Error('DATABASE_URL has no "database=" part — cannot derive the test database URL.');
  return base.replace(/((?:^|;)\s*(?:database|initial catalog)\s*=\s*)[^;]+/i, `$1${TEST_DB_NAME}`);
}

/** Throw unless the URL targets a `*_TEST` database. */
export function assertTestDatabaseUrl(url: string): void {
  const name = databaseName(url);
  if (!name || !/_TEST$/i.test(name)) {
    throw new Error(
      `Refusing to run integration tests against database "${name ?? 'unknown'}". ` +
        `The target database name must end in "_TEST".`
    );
  }
}

/** Throw unless the live connection's current database ends in `_TEST` (checked via `DB_NAME()`). */
export function assertConnectedToTestDb(currentDb: string | null | undefined): void {
  if (!currentDb || !/_TEST$/i.test(currentDb)) {
    throw new Error(
      `Connected database is "${currentDb ?? 'unknown'}", not a *_TEST database — aborting before any test runs.`
    );
  }
}
