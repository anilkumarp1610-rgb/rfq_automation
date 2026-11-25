/**
 * Integration-suite bootstrap — runs before every integration test file, and BEFORE the app
 * (or Prisma) is imported, so all of these take effect first. `.env` never overrides a
 * variable that is already set, which is what makes this work.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { beforeAll, afterAll } from 'vitest';
import { assertConnectedToTestDb, assertTestDatabaseUrl, deriveTestUrl } from './db-guard.js';

dotenv.config(); // pulls the developer's DATABASE_URL (credentials) from apps/api/.env

const testUrl = deriveTestUrl(process.env);
assertTestDatabaseUrl(testUrl); // 1st guard: the URL itself
process.env.DATABASE_URL = testUrl;

process.env.NODE_ENV = 'test'; // disables rate limiting
process.env.JWT_SECRET = 'integration-test-secret-0123456789abcdef0123456789'; // never the real one
process.env.ANTHROPIC_API_KEY = 'sk-ant-'; // placeholder -> deterministic mock extraction, never a paid call
process.env.SPEC_ALLOW_MOCK = 'true'; // the sample extractor must be switched on explicitly; tests need it
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rfq-test-uploads-'));

beforeAll(async () => {
  // 2nd guard: ask the server which database we are really connected to.
  const { prisma } = await import('../lib/prisma.js');
  const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT DB_NAME() AS db`;
  assertConnectedToTestDb(rows[0]?.db);
});

afterAll(async () => {
  const { prisma } = await import('../lib/prisma.js');
  await prisma.$disconnect();
  fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true });
});
