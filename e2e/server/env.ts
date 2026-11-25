/**
 * Shared by the browser tests' API launcher and seeder (both run under tsx).
 *
 * Same safety rails as the API integration suite: the database is derived as `RFQ_TEST` (or
 * `TEST_DATABASE_URL`), the URL must end in `_TEST`, and the live connection is re-checked with
 * DB_NAME() before anything is written. Nothing here ever touches RFQ_DB.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { assertTestDatabaseUrl, deriveTestUrl } from '../../apps/api/src/test-support/db-guard.js';

export const API_PORT = 4010;
export const WEB_PORT = 5183;
export const PASSWORD = 'E2e@12345';

export function useTestEnvironment() {
  dotenv.config({ path: path.resolve(import.meta.dirname, '../../apps/api/.env') }); // credentials only
  const url = deriveTestUrl(process.env);
  assertTestDatabaseUrl(url);
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test'; // rate limits off, 5xx messages masked like production
  process.env.JWT_SECRET = 'e2e-test-secret-0123456789abcdef0123456789abcdef';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-'; // placeholder -> mock extraction, never a paid call
  process.env.SPEC_ALLOW_MOCK = 'true'; // the sample extractor must be switched on explicitly
  process.env.PORT = String(API_PORT);
  process.env.UPLOAD_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'rfq-e2e-uploads-'));
}
