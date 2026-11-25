import { beforeAll, describe, expect, it } from 'vitest';
import jsonwebtoken from 'jsonwebtoken';
import { as, createUser, http, PASSWORD, prisma, type TestUser } from '../test-support/helpers.js';

let admin: TestUser;
let estimator: TestUser;

beforeAll(async () => {
  admin = await createUser('ADMIN');
  estimator = await createUser('ESTIMATOR');
});

describe('harness safety', () => {
  it('is connected to a *_TEST database (never the live one)', async () => {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT DB_NAME() AS db`;
    expect(db).toMatch(/_TEST$/i);
  });
});

describe('POST /auth/login', () => {
  it('returns a token and the user with roles', async () => {
    const res = await http().post('/auth/login').send({ email: estimator.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: estimator.email, roles: ['ESTIMATOR'] });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
  });

  it('rejects a wrong password and an unknown email with the same 401', async () => {
    const wrong = await http().post('/auth/login').send({ email: estimator.email, password: 'nope-nope' });
    const unknown = await http().post('/auth/login').send({ email: 'nobody@itest.local', password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error); // no account enumeration
  });

  it('rejects an inactive account with 403', async () => {
    const inactive = await createUser('VIEWER', { isActive: false });
    const res = await http().post('/auth/login').send({ email: inactive.email, password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('validates the body (422)', async () => {
    const res = await http().post('/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
  });
});

describe('token handling', () => {
  it('requires a token (401) and rejects a garbage token (403)', async () => {
    expect((await http().get('/rfqs')).status).toBe(401);
    expect((await http().get('/rfqs').set('Authorization', 'Bearer not.a.jwt')).status).toBe(403);
  });

  it('REJECTS a token forged with the old hardcoded default secret', async () => {
    const forged = jsonwebtoken.sign({ userId: admin.id, email: admin.email, roles: ['ADMIN'] }, 'your-secret-key');
    const res = await http().get('/users').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(403);
  });

  it('rejects an expired token', async () => {
    const expired = jsonwebtoken.sign({ userId: admin.id, email: admin.email, roles: ['ADMIN'] }, process.env.JWT_SECRET!, {
      expiresIn: -10,
    });
    expect((await http().get('/users').set('Authorization', `Bearer ${expired}`)).status).toBe(403);
  });
});

describe('self-registration is disabled', () => {
  it('POST /auth/register does not exist', async () => {
    const res = await http()
      .post('/auth/register')
      .send({ email: `intruder-${Date.now()}@itest.local`, name: 'Intruder', password: 'Passw0rd!' });
    expect(res.status).toBe(404);
  });
});

describe('GET /auth/me and POST /auth/refresh', () => {
  it('/me returns the current user and roles', async () => {
    const res = await as(estimator).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: estimator.id, email: estimator.email, roles: ['ESTIMATOR'] });
  });

  it('/refresh issues a working token', async () => {
    const res = await as(estimator).post('/auth/refresh');
    expect(res.status).toBe(200);
    const again = await http().get('/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(again.status).toBe(200);
  });

  it('/me and /refresh refuse a user who has since been deactivated', async () => {
    const u = await createUser('ESTIMATOR');
    await prisma.user.update({ where: { id: BigInt(u.id) }, data: { isActive: false } });
    expect((await as(u).get('/auth/me')).status).toBe(401);
    expect((await as(u).post('/auth/refresh')).status).toBe(401);
  });
});
