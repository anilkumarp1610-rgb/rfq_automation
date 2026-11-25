import dotenv from 'dotenv';

/**
 * Load `.env` and validate security-critical settings.
 *
 * MUST be the first import of the entry point: ES imports are evaluated before the
 * importing module's body, so a `dotenv.config()` call in index.ts runs too late for
 * modules (jwt.ts, analyze.ts…) that read `process.env` while loading.
 */
dotenv.config();

const PLACEHOLDER_SECRETS = new Set([
  'your-secret-key',
  'change-me-to-a-long-random-string',
  'secret',
  'changeme',
]);
const MIN_SECRET_LENGTH = 32;

export const isProd = process.env.NODE_ENV === 'production';

function secretProblem(secret: string | undefined): string | null {
  if (!secret) return 'JWT_SECRET is not set';
  if (PLACEHOLDER_SECRETS.has(secret)) return 'JWT_SECRET is still a placeholder value';
  if (secret.length < MIN_SECRET_LENGTH) return `JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`;
  return null;
}

/** Dev-only fallback so a fresh checkout still boots; never accepted in production. */
const DEV_FALLBACK_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';

const problem = secretProblem(process.env.JWT_SECRET);
if (problem) {
  if (isProd) {
    // Refuse to start: a guessable secret means anyone can forge an admin token.
    throw new Error(`${problem}. Set a long random JWT_SECRET (e.g. \`openssl rand -hex 48\`) before running in production.`);
  }
  console.warn(`⚠ ${problem} — using an insecure development secret. Set JWT_SECRET in apps/api/.env.`);
}

/** The signing secret for JWTs (validated above). */
export const JWT_SECRET: string = problem ? DEV_FALLBACK_SECRET : (process.env.JWT_SECRET as string);
