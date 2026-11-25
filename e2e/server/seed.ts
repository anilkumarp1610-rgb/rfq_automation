/**
 * Creates / resets the browser tests' fixture users in RFQ_TEST (idempotent — safe to rerun).
 * Data the tests need beyond users (customer, part, 30 RFQs) is created through the API in global-setup.
 */
import bcrypt from 'bcrypt';
import { useTestEnvironment, PASSWORD } from './env.js';
import { assertConnectedToTestDb } from '../../apps/api/src/test-support/db-guard.js';

useTestEnvironment();
const { prisma } = await import('../../apps/api/src/lib/prisma.js');
const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT DB_NAME() AS db`;
assertConnectedToTestDb(db);

const hash = await bcrypt.hash(PASSWORD, 4);
for (const role of ['ADMIN', 'MANAGER', 'ESTIMATOR', 'VIEWER'] as const) {
  const roleRow = await prisma.role.findUnique({ where: { code: role } });
  if (!roleRow) throw new Error(`Role ${role} missing from ${db} — run: npm run test:db -- seed`);
  const email = `e2e-${role.toLowerCase()}@e2e.local`;
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, isActive: true },
    create: { name: `E2E ${role}`, email, passwordHash: hash, isActive: true },
  });
  // exactly one role, the intended one
  await prisma.userRole.deleteMany({ where: { userId: user.id } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });
}
// the user the "deactivated" test flips on and off
await prisma.user.upsert({
  where: { email: 'e2e-leaver@e2e.local' },
  update: { passwordHash: hash, isActive: true },
  create: { name: 'E2E Leaver', email: 'e2e-leaver@e2e.local', passwordHash: hash, isActive: true },
});
const viewer = await prisma.role.findUnique({ where: { code: 'VIEWER' } });
const leaver = await prisma.user.findUniqueOrThrow({ where: { email: 'e2e-leaver@e2e.local' } });
await prisma.userRole.deleteMany({ where: { userId: leaver.id } });
await prisma.userRole.create({ data: { userId: leaver.id, roleId: viewer!.id } });

await prisma.$disconnect();
console.log(`e2e users ready in ${db}`);
