import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));

// vi.hoisted runs BEFORE the imports below, so the jwt / env modules see a strong secret and the suite
// is hermetic (never the developer's .env). dotenv does not override a variable that is already set.
vi.hoisted(() => {
  process.env.JWT_SECRET = 'unit-test-secret-0123456789abcdef0123456789abcdef';
});

import jsonwebtoken from 'jsonwebtoken';
import { generateToken } from '../lib/jwt.js';
import { authenticateToken, requireRole, userId, canEditMasters, canEditRfq, canManageUsers } from './auth.js';

type Req = { headers: Record<string, string | undefined>; user?: { userId: string; email: string; roles: string[] } };
const makeRes = () => {
  const res = { statusCode: 0, body: undefined as unknown, status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation((c: number) => { res.statusCode = c; return res; });
  res.json.mockImplementation((b: unknown) => { res.body = b; return res; });
  return res;
};
const bearer = (token: string): Req => ({ headers: { authorization: `Bearer ${token}` } });
const tokenFor = (userId: string, roles: string[] = ['ADMIN']) => generateToken({ userId, email: 'old@x.y', roles });
const dbUser = (over: Record<string, unknown> = {}) => ({
  email: 'live@x.y', isActive: true, roles: [{ role: { code: 'ESTIMATOR' } }], ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('authenticateToken — rejecting the request', () => {
  it('401 when there is no Authorization header', async () => {
    const res = makeRes(), next = vi.fn();
    await authenticateToken({ headers: {} } as never, res as never, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(db.user.findUnique).not.toHaveBeenCalled(); // no point querying without a token
  });

  it('401 for "Bearer" with no token after it', async () => {
    const res = makeRes(), next = vi.fn();
    await authenticateToken({ headers: { authorization: 'Bearer' } } as never, res as never, next);
    expect(res.statusCode).toBe(401);
  });

  it('403 for a malformed token, without touching the database', async () => {
    const res = makeRes(), next = vi.fn();
    await authenticateToken(bearer('not.a.jwt') as never, res as never, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('403 for a token signed with a different secret (e.g. the old hardcoded one)', async () => {
    const forged = jsonwebtoken.sign({ userId: '1', email: 'a@b', roles: ['ADMIN'] }, 'your-secret-key');
    const res = makeRes(), next = vi.fn();
    await authenticateToken(bearer(forged) as never, res as never, next);
    expect(res.statusCode).toBe(403);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('403 for an expired token', async () => {
    const expired = jsonwebtoken.sign({ userId: '1', email: 'a@b', roles: [] }, process.env.JWT_SECRET!, { expiresIn: -5 });
    const res = makeRes(), next = vi.fn();
    await authenticateToken(bearer(expired) as never, res as never, next);
    expect(res.statusCode).toBe(403);
  });

  it('401 when the user no longer exists', async () => {
    db.user.findUnique.mockResolvedValue(null);
    const res = makeRes(), next = vi.fn();
    await authenticateToken(bearer(tokenFor('5')) as never, res as never, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401 when the user has been deactivated — a valid token is not enough', async () => {
    db.user.findUnique.mockResolvedValue(dbUser({ isActive: false }));
    const res = makeRes(), next = vi.fn();
    await authenticateToken(bearer(tokenFor('5')) as never, res as never, next);
    expect(res.statusCode).toBe(401);
    expect((res.body as { error: string }).error).toMatch(/inactive|no longer/i);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('authenticateToken — accepting the request', () => {
  it('looks the user up by the id in the token', async () => {
    db.user.findUnique.mockResolvedValue(dbUser());
    await authenticateToken(bearer(tokenFor('42')) as never, makeRes() as never, vi.fn());
    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
    expect(db.user.findUnique.mock.calls[0][0].where).toEqual({ id: 42n });
  });

  it('takes roles and email from the DATABASE, never from the token', async () => {
    // the token claims ADMIN + an old email; the database says ESTIMATOR + a new email
    db.user.findUnique.mockResolvedValue(dbUser({ email: 'new@x.y', roles: [{ role: { code: 'ESTIMATOR' } }] }));
    const req = bearer(tokenFor('5', ['ADMIN'])) as Req, next = vi.fn();
    await authenticateToken(req as never, makeRes() as never, next);
    expect(next).toHaveBeenCalledWith(); // called with no error
    expect(req.user).toEqual({ userId: '5', email: 'new@x.y', roles: ['ESTIMATOR'] });
  });

  it('a demoted admin is no longer an admin on the very next request', async () => {
    db.user.findUnique.mockResolvedValue(dbUser({ roles: [{ role: { code: 'VIEWER' } }] }));
    const req = bearer(tokenFor('5', ['ADMIN'])) as Req;
    await authenticateToken(req as never, makeRes() as never, vi.fn());
    expect(req.user!.roles).toEqual(['VIEWER']);
    expect(req.user!.roles).not.toContain('ADMIN');
  });

  it('supports several roles and a user with none', async () => {
    db.user.findUnique.mockResolvedValue(dbUser({ roles: [{ role: { code: 'MANAGER' } }, { role: { code: 'ESTIMATOR' } }] }));
    const a = bearer(tokenFor('5')) as Req;
    await authenticateToken(a as never, makeRes() as never, vi.fn());
    expect(a.user!.roles).toEqual(['MANAGER', 'ESTIMATOR']);

    db.user.findUnique.mockResolvedValue(dbUser({ roles: [] }));
    const b = bearer(tokenFor('5')) as Req;
    await authenticateToken(b as never, makeRes() as never, vi.fn());
    expect(b.user!.roles).toEqual([]);
  });

  it('hands a database failure to the error handler instead of crashing or hanging', async () => {
    const boom = new Error('connection lost');
    db.user.findUnique.mockRejectedValue(boom);
    const res = makeRes(), next = vi.fn();
    await authenticateToken(bearer(tokenFor('5')) as never, res as never, next);
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  const call = (mw: ReturnType<typeof requireRole>, roles?: string[]) => {
    const res = makeRes(), next = vi.fn();
    mw((roles ? { user: { userId: '1', email: 'a@b', roles } } : {}) as never, res as never, next);
    return { res, next };
  };

  it('401 when nobody is signed in', () => {
    const { res, next } = call(requireRole('ESTIMATOR'));
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets a holder of a listed role through', () => {
    expect(call(requireRole('ESTIMATOR'), ['ESTIMATOR']).next).toHaveBeenCalled();
    expect(call(requireRole('MANAGER', 'ESTIMATOR'), ['ESTIMATOR']).next).toHaveBeenCalled();
  });

  it('ADMIN always passes, even for a role it does not hold', () => {
    expect(call(requireRole('ESTIMATOR'), ['ADMIN']).next).toHaveBeenCalled();
    expect(call(requireRole(), ['ADMIN']).next).toHaveBeenCalled();
  });

  it('403 for a signed-in user without the role', () => {
    const { res, next } = call(requireRole('MANAGER'), ['VIEWER']);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('403 for a user with no roles at all', () => {
    expect(call(requireRole('VIEWER'), []).res.statusCode).toBe(403);
  });

  it('passes when ANY of several held roles matches', () => {
    expect(call(requireRole('MANAGER'), ['VIEWER', 'MANAGER']).next).toHaveBeenCalled();
  });

  it('role names are exact (case-sensitive)', () => {
    expect(call(requireRole('MANAGER'), ['manager']).res.statusCode).toBe(403);
  });
});

describe('the named permission guards', () => {
  const allowed = (mw: ReturnType<typeof requireRole>, role: string) => {
    const next = vi.fn();
    mw({ user: { userId: '1', email: 'a@b', roles: [role] } } as never, makeRes() as never, next);
    return next.mock.calls.length > 0;
  };

  it.each([
    ['canEditMasters', canEditMasters, { ADMIN: true, MANAGER: true, ESTIMATOR: false, VIEWER: false }],
    ['canEditRfq', canEditRfq, { ADMIN: true, MANAGER: true, ESTIMATOR: true, VIEWER: false }],
    ['canManageUsers', canManageUsers, { ADMIN: true, MANAGER: false, ESTIMATOR: false, VIEWER: false }],
  ] as const)('%s', (_name, guard, expected) => {
    for (const [role, ok] of Object.entries(expected)) {
      expect(allowed(guard, role), `${_name} for ${role}`).toBe(ok);
    }
  });

  it('a custom (unwired) role gets no permissions beyond view-only', () => {
    for (const guard of [canEditMasters, canEditRfq, canManageUsers]) expect(allowed(guard, 'CUSTOM_AUDITOR')).toBe(false);
  });
});

describe('userId', () => {
  it('returns the signed-in user id as a bigint', () => {
    expect(userId({ user: { userId: '123', email: 'a@b', roles: [] } } as never)).toBe(123n);
  });
});
