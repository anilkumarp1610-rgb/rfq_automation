import { beforeAll, describe, expect, it } from 'vitest';
import { as, createUser, http, prisma, type TestUser } from '../test-support/helpers.js';

/**
 * A token proves who someone was at login. Access must follow the user's CURRENT state in the
 * database, so deactivating or demoting someone takes effect on their very next request —
 * not when their (up to 24 h) token expires.
 */
let admin: TestUser;
let roleId: Record<string, bigint>;

beforeAll(async () => {
  admin = await createUser('ADMIN');
  const roles = await prisma.role.findMany();
  roleId = Object.fromEntries(roles.map((r) => [r.code, r.id]));
});

const setActive = (u: TestUser, isActive: boolean) =>
  prisma.user.update({ where: { id: BigInt(u.id) }, data: { isActive } });

const setRole = async (u: TestUser, code: string) => {
  await prisma.userRole.deleteMany({ where: { userId: BigInt(u.id) } });
  await prisma.userRole.create({ data: { userId: BigInt(u.id), roleId: roleId[code] } });
};

describe('deactivated users lose access immediately', () => {
  it('an already-issued token stops working on the very next request', async () => {
    const u = await createUser('ESTIMATOR');
    expect((await as(u).get('/rfqs')).status).toBe(200);

    await setActive(u, false);
    const after = await as(u).get('/rfqs');
    expect(after.status).toBe(401);
    expect(after.body.error).toMatch(/inactive|no longer/i);
  });

  it('deactivating through the admin API (DELETE /users/:id) has the same effect', async () => {
    const u = await createUser('MANAGER');
    expect((await as(u).get('/customers')).status).toBe(200);
    expect((await as(admin).delete(`/users/${u.id}`)).status).toBe(204);
    expect((await as(u).get('/customers')).status).toBe(401);
  });

  it('access returns when the account is re-activated (no new login needed)', async () => {
    const u = await createUser('ESTIMATOR');
    await setActive(u, false);
    expect((await as(u).get('/rfqs')).status).toBe(401);
    await setActive(u, true);
    expect((await as(u).get('/rfqs')).status).toBe(200);
  });

  it('applies to downloads and write endpoints too, not just reads', async () => {
    const u = await createUser('ESTIMATOR');
    await setActive(u, false);
    expect((await as(u).post('/rfqs').send({})).status).toBe(401);
    expect((await as(u).get('/rfq-versions/1/quotation.pdf')).status).toBe(401);
  });
});

describe('role changes take effect immediately', () => {
  it('a demoted admin can no longer use admin endpoints', async () => {
    const u = await createUser('ADMIN');
    expect((await as(u).get('/users')).status).toBe(200);

    await setRole(u, 'VIEWER');
    expect((await as(u).get('/users')).status).toBe(403);
    expect((await as(u).get('/rfqs')).status).toBe(200); // still signed in, just less powerful
  });

  it('a promoted user gains the new permissions without logging in again', async () => {
    const u = await createUser('VIEWER');
    expect((await as(u).post('/customers').send({})).status).toBe(403);
    await setRole(u, 'MANAGER');
    expect((await as(u).post('/customers').send({})).status).not.toBe(403); // 422: now allowed, body invalid
  });

  it('a user with no role at all is treated as having no permissions', async () => {
    const u = await createUser('ESTIMATOR');
    await prisma.userRole.deleteMany({ where: { userId: BigInt(u.id) } });
    expect((await as(u).post('/rfqs').send({})).status).toBe(403);
  });
});

describe('a token for a user that no longer exists', () => {
  it('is rejected (401)', async () => {
    const u = await createUser('ESTIMATOR');
    await prisma.userRole.deleteMany({ where: { userId: BigInt(u.id) } });
    await prisma.user.delete({ where: { id: BigInt(u.id) } });
    expect((await as(u).get('/rfqs')).status).toBe(401);
  });
});

describe('/auth/me reports the CURRENT roles, and /auth/refresh re-issues them', () => {
  it('reflects a role change and issues a token carrying the new roles', async () => {
    const u = await createUser('ESTIMATOR');
    await setRole(u, 'MANAGER');
    expect((await as(u).get('/auth/me')).body.roles).toEqual(['MANAGER']);
    const refreshed = await as(u).post('/auth/refresh');
    expect(refreshed.body.user.roles).toEqual(['MANAGER']);
    expect((await http().get('/auth/me').set('Authorization', `Bearer ${refreshed.body.token}`)).status).toBe(200);
  });
});
