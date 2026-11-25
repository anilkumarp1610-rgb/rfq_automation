import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as, createUser, http, prisma, stamp, type TestUser,
} from '../test-support/helpers.js';

let admin: TestUser;
let estimatorRoleId: string;
let managerRoleId: string;
let adminRoleId: string;

beforeAll(async () => {
  admin = await createUser('ADMIN');
  const roles = await prisma.role.findMany({ where: { code: { in: ['ESTIMATOR', 'MANAGER', 'ADMIN'] } } });
  const id = (code: string) => roles.find((r) => r.code === code)!.id.toString();
  estimatorRoleId = id('ESTIMATOR');
  managerRoleId = id('MANAGER');
  adminRoleId = id('ADMIN');
});

const newUserBody = (over: Record<string, unknown> = {}) => ({
  name: 'Created By Test',
  email: `created-${stamp()}@itest.local`,
  phone: '9999999999',
  password: 'Secret@123',
  roleId: estimatorRoleId,
  ...over,
});

describe('POST /users', () => {
  it('creates a user who can then log in, and never returns the password hash', async () => {
    const body = newUserBody();
    const res = await as(admin).post('/users').send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: body.email, name: body.name, isActive: true, role: { code: 'ESTIMATOR' } });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const login = await http().post('/auth/login').send({ email: body.email, password: body.password });
    expect(login.status).toBe(200);
    expect(login.body.user.roles).toEqual(['ESTIMATOR']);
  });

  it('stores the email lower-cased and rejects a duplicate in any case (409)', async () => {
    const email = `MixedCase-${stamp()}@Itest.Local`;
    expect((await as(admin).post('/users').send(newUserBody({ email }))).status).toBe(201);
    const dup = await as(admin).post('/users').send(newUserBody({ email: email.toLowerCase() }));
    expect(dup.status).toBe(409);
  });

  it('rejects an unknown role (400) and bad input (422)', async () => {
    expect((await as(admin).post('/users').send(newUserBody({ roleId: '999999999' }))).status).toBe(400);
    expect((await as(admin).post('/users').send(newUserBody({ password: '123' }))).status).toBe(422);
    expect((await as(admin).post('/users').send(newUserBody({ email: 'nope' }))).status).toBe(422);
  });
});

describe('PUT /users/:id', () => {
  it('changes the role, and a blank password keeps the existing one', async () => {
    const body = newUserBody();
    const created = (await as(admin).post('/users').send(body)).body;

    const res = await as(admin)
      .put(`/users/${created.id}`)
      .send({ name: 'Renamed', email: body.email, phone: '', password: '', roleId: managerRoleId, isActive: true });
    expect(res.status).toBe(200);
    expect(res.body.role.code).toBe('MANAGER');
    expect(res.body.name).toBe('Renamed');

    const login = await http().post('/auth/login').send({ email: body.email, password: body.password });
    expect(login.status).toBe(200); // old password still works
    expect(login.body.user.roles).toEqual(['MANAGER']);
  });

  it('a new password replaces the old one', async () => {
    const body = newUserBody();
    const created = (await as(admin).post('/users').send(body)).body;
    await as(admin)
      .put(`/users/${created.id}`)
      .send({ name: body.name, email: body.email, password: 'Brand@New1', roleId: estimatorRoleId, isActive: true });
    expect((await http().post('/auth/login').send({ email: body.email, password: body.password })).status).toBe(401);
    expect((await http().post('/auth/login').send({ email: body.email, password: 'Brand@New1' })).status).toBe(200);
  });

  it('refuses an email that belongs to another user (409) and an unknown user (404)', async () => {
    const a = (await as(admin).post('/users').send(newUserBody())).body;
    const b = (await as(admin).post('/users').send(newUserBody())).body;
    const clash = await as(admin)
      .put(`/users/${b.id}`)
      .send({ name: 'x y', email: a.email, roleId: estimatorRoleId, isActive: true });
    expect(clash.status).toBe(409);
    const missing = await as(admin)
      .put('/users/999999999')
      .send({ name: 'x y', email: `m-${stamp()}@itest.local`, roleId: estimatorRoleId, isActive: true });
    expect(missing.status).toBe(404);
  });

  it('you cannot deactivate your own account', async () => {
    const res = await as(admin)
      .put(`/users/${admin.id}`)
      .send({ name: 'ITest ADMIN', email: admin.email, roleId: adminRoleId, isActive: false });
    // the "last admin" guard may fire first when others exist; either way it must be refused
    expect(res.status).toBe(400);
  });
});

describe('DELETE /users/:id (soft delete)', () => {
  it('deactivates the user: they can no longer log in, and the row is kept', async () => {
    const body = newUserBody();
    const created = (await as(admin).post('/users').send(body)).body;
    expect((await as(admin).delete(`/users/${created.id}`)).status).toBe(204);

    expect((await http().post('/auth/login').send({ email: body.email, password: body.password })).status).toBe(403);
    const row = await prisma.user.findUnique({ where: { id: BigInt(created.id) } });
    expect(row?.isActive).toBe(false);
  });

  it('you cannot delete yourself, and unknown users are 404', async () => {
    expect((await as(admin).delete(`/users/${admin.id}`)).status).toBe(400);
    expect((await as(admin).delete('/users/999999999')).status).toBe(404);
  });
});

/**
 * "Last active administrator" protection. Access follows the live database (see session.int.test),
 * so a demoted or deactivated admin can no longer act — which means the only way to threaten the last
 * admin is for that admin to act on their own account. The test DB may contain other admins, so for
 * the duration of this block every OTHER active admin is switched off, and restored afterwards.
 */
describe('the last active administrator is protected', () => {
  let sole: TestUser; // the only active admin while this block runs
  let parked: bigint[] = [];

  beforeAll(async () => {
    sole = await createUser('ADMIN');
    const others = await prisma.user.findMany({
      where: { isActive: true, roles: { some: { role: { code: 'ADMIN' } } }, id: { notIn: [BigInt(sole.id)] } },
      select: { id: true },
    });
    parked = others.map((o) => o.id);
    await prisma.user.updateMany({ where: { id: { in: parked } }, data: { isActive: false } });
  });

  afterAll(async () => {
    await prisma.user.updateMany({ where: { id: { in: parked } }, data: { isActive: true } });
  });

  const selfUpdate = (over: Record<string, unknown>) =>
    as(sole).put(`/users/${sole.id}`).send({ name: 'ITest ADMIN', email: sole.email, roleId: adminRoleId, isActive: true, ...over });

  it('the sole admin cannot demote themself', async () => {
    const res = await selfUpdate({ roleId: managerRoleId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last active administrator/i);
  });

  it('the sole admin cannot deactivate or delete themself', async () => {
    expect((await selfUpdate({ isActive: false })).status).toBe(400);
    expect((await as(sole).delete(`/users/${sole.id}`)).status).toBe(400);
  });

  it('nothing above changed the sole admin, who can still administer', async () => {
    const row = await prisma.user.findUnique({ where: { id: BigInt(sole.id) } });
    expect(row?.isActive).toBe(true);
    expect((await as(sole).get('/users')).status).toBe(200);
  });

  it('with a second active admin, one may delete the other', async () => {
    const second = await createUser('ADMIN');
    expect((await as(sole).delete(`/users/${second.id}`)).status).toBe(204);
    expect((await as(second).get('/users')).status).toBe(401); // and the deleted admin is locked out at once
  });

  it('with a second active admin, an admin may demote themself — and immediately loses admin rights', async () => {
    const second = await createUser('ADMIN');
    const res = await as(second)
      .put(`/users/${second.id}`)
      .send({ name: 'ITest ADMIN', email: second.email, roleId: managerRoleId, isActive: true });
    expect(res.status).toBe(200);
    expect((await as(second).get('/users')).status).toBe(403);
  });
});

describe('/roles', () => {
  it('lists the four built-in system roles', async () => {
    const res = await as(admin).get('/roles');
    expect(res.status).toBe(200);
    const codes = res.body.filter((r: { isSystem: boolean }) => r.isSystem).map((r: { code: string }) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['ADMIN', 'MANAGER', 'ESTIMATOR', 'VIEWER']));
  });

  it('adds a custom (non-system) role, rejects a duplicate code, and renames', async () => {
    const code = `CUSTOM_${stamp()}`;
    const created = await as(admin).post('/roles').send({ code, name: 'Custom Role', description: 'for tests' });
    expect(created.status).toBe(201);
    expect(created.body.isSystem).toBe(false);

    expect((await as(admin).post('/roles').send({ code, name: 'Again' })).status).toBe(409);

    const renamed = await as(admin).put(`/roles/${created.body.id}`).send({ name: 'Renamed Role', description: '' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Renamed Role');
  });

  it('cannot be deleted (405)', async () => {
    const created = await as(admin).post('/roles').send({ code: `TMP_${stamp()}`, name: 'Temp' });
    expect((await as(admin).delete(`/roles/${created.body.id}`)).status).toBe(405);
  });
});
