import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { errorHandler } from './errorHandler.js';

const makeRes = () => {
  const res = { statusCode: 0, body: undefined as any, status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation((c: number) => { res.statusCode = c; return res; });
  res.json.mockImplementation((b: unknown) => { res.body = b; return res; });
  return res;
};
const handle = (err: unknown) => {
  const res = makeRes();
  errorHandler(err as never, {} as never, res as never, vi.fn());
  return res;
};
const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('db says no', { code, clientVersion: 'test', meta });

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('errorHandler — validation', () => {
  it('turns a Zod error into 422 with per-field issues', () => {
    const parsed = z.object({ name: z.string().min(2), age: z.number() }).safeParse({ name: 'x', age: 'old' });
    const res = handle((parsed as { error: z.ZodError }).error);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(['age', 'name']);
    expect(res.body.issues[0]).toHaveProperty('message');
  });

  it('turns a Prisma query-shape error into a generic 400 that leaks no internals', () => {
    const res = handle(new Prisma.PrismaClientValidationError('Unknown arg `passwordHash` in orderBy for model User', { clientVersion: 'test' }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid request parameters' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|orderBy|model/i);
  });
});

describe('errorHandler — database constraint errors', () => {
  it('P2002 (duplicate) -> 409, naming the column when Prisma tells us which', () => {
    const res = handle(known('P2002', { target: ['rfq_number'] }));
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('A record with this rfq_number already exists');
  });

  it('P2002 joins several columns', () => {
    expect(handle(known('P2002', { target: ['a', 'b'] })).body.error).toBe('A record with this a, b already exists');
  });

  it('P2002 without a usable target still says it is a duplicate', () => {
    expect(handle(known('P2002')).body.error).toBe('A record with these values already exists');
    expect(handle(known('P2002', { target: 'not-an-array' })).body.error).toBe('A record with these values already exists');
  });

  it('P2025 (not found) -> 404', () => {
    const res = handle(known('P2025'));
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('Record not found');
  });

  it('P2003 (foreign key) -> 409', () => {
    const res = handle(known('P2003'));
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/in use/i);
  });

  it('never exposes the raw database message for a known constraint error', () => {
    for (const code of ['P2002', 'P2025', 'P2003']) {
      expect(JSON.stringify(handle(known(code, { target: ['x'] })).body)).not.toContain('db says no');
    }
  });
});

describe('errorHandler — errors raised by our own routes', () => {
  it('uses the status and message of an error that carries one (badRequest / notFound)', () => {
    const res = handle(Object.assign(new Error('RFQ not found'), { status: 404 }));
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('RFQ not found');
  });

  it.each([400, 401, 403, 404, 409, 422])('passes a %i through', (status) => {
    expect(handle(Object.assign(new Error('x'), { status })).statusCode).toBe(status);
  });

  it('does not log 4xx errors as server errors', () => {
    handle(Object.assign(new Error('nope'), { status: 400 }));
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('errorHandler — unexpected failures', () => {
  it('an error with no status is a 500, and is logged', () => {
    const res = handle(new Error('kaboom'));
    expect(res.statusCode).toBe(500);
    expect(console.error).toHaveBeenCalled();
  });

  it('falls back to a generic message when the error has none', () => {
    expect(handle(Object.assign(new Error(''), { status: 500 })).body.error).toBe('Internal server error');
  });

  it('includes a stack trace only in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(handle(new Error('kaboom')).body).toHaveProperty('stack');

    vi.stubEnv('NODE_ENV', 'production');
    expect(handle(new Error('kaboom')).body).not.toHaveProperty('stack');
  });

  it('never includes a stack for client errors, even in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(handle(Object.assign(new Error('bad'), { status: 400 })).body).not.toHaveProperty('stack');
  });
});

describe('errorHandler — 5xx messages are not leaked', () => {
  const SECRET = "Invalid `prisma.user.findMany()` invocation: Can't reach database server at `sql-prod-01:1433`";

  it.each(['production', 'test', ''])('hides the message of an unexpected error (NODE_ENV=%j)', (env) => {
    vi.stubEnv('NODE_ENV', env);
    const res = handle(new Error(SECRET));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|sql-prod|1433/);
  });

  it('hides the message of any 5xx that is not marked safe, not just 500', () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const status of [500, 502, 503]) {
      expect(handle(Object.assign(new Error(SECRET), { status })).body.error).toBe('Internal server error');
    }
  });

  it('still logs the real error for operators', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const err = new Error(SECRET);
    handle(err);
    expect(console.error).toHaveBeenCalledWith('Error:', err);
  });

  it('shows a 5xx written for the user when it is marked expose', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = handle(Object.assign(new Error('The model declined to analyze this file'), { status: 502, expose: true }));
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('The model declined to analyze this file');
  });

  it('developers still see the real message and stack', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const res = handle(new Error(SECRET));
    expect(res.body.error).toBe(SECRET);
    expect(res.body).toHaveProperty('stack');
  });

  it('does not touch 4xx messages, which are written for the user', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(handle(Object.assign(new Error('Customer not found'), { status: 404 })).body.error).toBe('Customer not found');
  });
});

describe('errorHandler — AI provider failures', () => {
  const providerError = (status: number) =>
    Anthropic.APIError.generate(status, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key sk-ant-SECRET' } }, 'upstream said no', new Headers());

  it.each([401, 403, 429, 500, 529])('reports an upstream %i as a plain 502 without its message', (status) => {
    const err = providerError(status);
    expect(err).toBeInstanceOf(Anthropic.APIError);
    const res = handle(err);
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/sk-ant|x-api-key|upstream/);
  });

  it('never forwards the provider 401 — the browser would treat it as an expired user session', () => {
    expect(handle(providerError(401)).statusCode).not.toBe(401);
  });

  const providerWith = (status: number, message: string) =>
    Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message } }, message, new Headers());

  it.each([
    [400, 'Your credit balance is too low to access the Anthropic API.', /no credit left/],
    [401, 'invalid x-api-key', /rejected the API key/],
    [403, 'forbidden', /rejected the API key/],
    [429, 'rate limited', /rate-limiting/],
    [413, 'request too large', /too large or too many pages/],
    [400, 'prompt is too long: 250000 tokens', /too large or too many pages/],
    [529, 'overloaded', /temporarily unavailable/],
    [400, 'something else entirely', /request failed/],
  ])('explains upstream %i "%s" with an actionable fixed message', (status, message, expected) => {
    const res = handle(providerWith(status, message));
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(expected);
    expect(res.body.error).not.toContain(message); // never the provider's own text
  });
});
