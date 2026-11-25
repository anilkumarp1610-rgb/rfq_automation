/**
 * Run Prisma tasks against the *_TEST database ONLY — never the live one.
 *
 *   npm run test:db -- migrate     apply pending migrations to RFQ_TEST
 *   npm run test:db -- seed        run the seed against RFQ_TEST
 *   npm run test:db -- status      show migration status of RFQ_TEST
 *   npm run test:db -- drift       fail if RFQ_TEST's real structure differs from schema.prisma
 *   npm run test:db -- prisma migrate resolve --rolled-back <name>   any other Prisma command
 *
 * The URL is TEST_DATABASE_URL, or DATABASE_URL (from apps/api/.env) with the database swapped for
 * RFQ_TEST — the same rule the integration suite uses, with the same `_TEST` name guard.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';
import { assertTestDatabaseUrl, databaseName, deriveTestUrl } from '../apps/api/src/test-support/db-guard.js';

const root = path.resolve(import.meta.dirname, '..');
dotenv.config({ path: path.join(root, 'apps/api/.env') });

const url = deriveTestUrl(process.env);
assertTestDatabaseUrl(url);
console.log(`Target database: ${databaseName(url)}`);

const commands: Record<string, string[]> = {
  migrate: ['prisma', 'migrate', 'deploy', '--schema=prisma/schema.prisma'],
  status: ['prisma', 'migrate', 'status', '--schema=prisma/schema.prisma'],
  seed: ['tsx', 'prisma/seed.ts'],
  // exit 0 = RFQ_TEST's real structure matches schema.prisma exactly; 2 = drift (the diff is printed)
  // print the SQL that would turn RFQ_TEST into schema.prisma (basis for a new migration)
  diffsql: ['prisma', 'migrate', 'diff', '--from-url', JSON.stringify(url), '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
  drift: ['prisma', 'migrate', 'diff', '--from-url', JSON.stringify(url), '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'],
};
const which = process.argv[2];
// `-- prisma <args…>` passes any Prisma command through, still pinned to the *_TEST database
const cmd = which === 'prisma' ? ['prisma', ...process.argv.slice(3), '--schema=prisma/schema.prisma'] : commands[which];
if (!cmd) {
  console.error(`Usage: npm run test:db -- <${Object.keys(commands).join('|')}|prisma …>`);
  process.exit(2);
}

const r = spawnSync('npx', cmd, {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(r.status ?? 1);
