/** Starts the real API against RFQ_TEST for the browser tests (Playwright's `webServer`). */
import { useTestEnvironment } from './env.js';
import { assertConnectedToTestDb } from '../../apps/api/src/test-support/db-guard.js';

useTestEnvironment();
const { prisma } = await import('../../apps/api/src/lib/prisma.js');
const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT DB_NAME() AS db`;
assertConnectedToTestDb(rows[0]?.db); // 2nd guard, same as the integration suite
await import('../../apps/api/src/index.js');
