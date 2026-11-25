/**
 * Shared helpers for the API integration tests (`*.int.test.ts`).
 * Only import this from files run under vitest.integration.config.ts — it pulls in the real
 * app and Prisma, which setup.ts has already pointed at the *_TEST database.
 */
import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from '../app.js';
import { prisma } from '../lib/prisma.js';

export { prisma };
export const PASSWORD = 'Itest@12345';
export type RoleCode = 'ADMIN' | 'MANAGER' | 'ESTIMATOR' | 'VIEWER';

/** Unique-ish suffix so reruns never collide on unique columns. */
export const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

export const http = () => request(app);

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: RoleCode;
  token: string;
}

/** Create an active user directly in the DB, then obtain a token through the real login endpoint. */
export async function createUser(role: RoleCode, opts: { isActive?: boolean } = {}): Promise<TestUser> {
  const roleRow = await prisma.role.findUnique({ where: { code: role } });
  if (!roleRow) {
    throw new Error(`Role ${role} is missing from the test DB — run the seed (npm run prisma:seed) against RFQ_TEST.`);
  }
  const email = `itest-${role.toLowerCase()}-${stamp()}@itest.local`;
  const user = await prisma.user.create({
    data: {
      name: `ITest ${role}`,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4), // low cost: speed over strength in tests
      isActive: opts.isActive ?? true,
      roles: { create: { roleId: roleRow.id } },
    },
  });
  const res = await http().post('/auth/login').send({ email, password: PASSWORD });
  const token = res.body?.token as string | undefined;
  if (!token && (opts.isActive ?? true)) throw new Error(`Login failed for fixture user ${email}: ${res.status}`);
  return { id: user.id.toString(), email, password: PASSWORD, role, token: token ?? '' };
}

/** Make an authenticated request builder: `as(user).get('/x')`. */
export function as(user: Pick<TestUser, 'token'>) {
  const auth = { Authorization: `Bearer ${user.token}` };
  return {
    get: (url: string) => http().get(url).set(auth),
    post: (url: string) => http().post(url).set(auth),
    put: (url: string) => http().put(url).set(auth),
    delete: (url: string) => http().delete(url).set(auth),
  };
}

/** GET a binary download (PDF / XLSX) and return its bytes. */
export async function getBinary(user: Pick<TestUser, 'token'>, url: string) {
  const res = await http()
    .get(url)
    .set('Authorization', `Bearer ${user.token}`)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  return { status: res.status, headers: res.headers, body: res.body as Buffer };
}

/** Create a customer through the API (as an admin/manager). */
export async function createCustomer(actor: TestUser, rating = 3) {
  const s = stamp();
  const res = await as(actor).post('/customers').send({ code: `IT${s}`.slice(0, 50), name: `ITest Customer ${s}`, rating });
  if (res.status !== 201) throw new Error(`createCustomer failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; code: string; name: string };
}

/** Create a customer part through the API. */
export async function createPart(actor: TestUser, customerId: string, partNumber = `ITP${stamp()}`) {
  const res = await as(actor).post('/customer-parts').send({
    customerId,
    customerPartNumber: partNumber,
    partName: `ITest part ${partNumber}`,
    currentRevision: 'R00',
  });
  if (res.status !== 201) throw new Error(`createPart failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; customerPartNumber: string };
}

/** Create an RFQ (+ revision 1) for a part through the API. */
export async function createRfq(actor: TestUser, customerPartId: string, extra: Record<string, unknown> = {}) {
  const res = await as(actor).post('/rfqs').send({ customerPartId, annualQty: 1000, batchQty: 100, ...extra });
  if (res.status !== 201) throw new Error(`createRfq failed: ${res.status} ${JSON.stringify(res.body)}`);
  const rfq = res.body as { id: string; rfqNumber: string; versions: { id: string; revisionNo: number; isCurrent: boolean }[] };
  return { rfq, versionId: rfq.versions[0].id };
}
