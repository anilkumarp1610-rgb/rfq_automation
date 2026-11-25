import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STRONG = 'a-properly-long-random-secret-0123456789abcdef';

/** Re-import env.ts fresh so its load-time validation runs against the stubbed environment. */
async function loadEnv() {
  vi.resetModules();
  return import('./env.js');
}

describe('lib/env — JWT_SECRET enforcement', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('production', () => {
    beforeEach(() => vi.stubEnv('NODE_ENV', 'production'));

    it('refuses to start without a secret', async () => {
      vi.stubEnv('JWT_SECRET', '');
      await expect(loadEnv()).rejects.toThrow(/JWT_SECRET is not set/);
    });
    it.each(['your-secret-key', 'change-me-to-a-long-random-string', 'secret', 'changeme'])(
      'refuses the placeholder "%s"',
      async (placeholder) => {
        vi.stubEnv('JWT_SECRET', placeholder);
        await expect(loadEnv()).rejects.toThrow(/placeholder/);
      }
    );
    it('refuses a secret shorter than 32 characters', async () => {
      vi.stubEnv('JWT_SECRET', 'too-short-secret');
      await expect(loadEnv()).rejects.toThrow(/shorter than 32/);
    });
    it('starts with a strong secret and exports exactly that secret', async () => {
      vi.stubEnv('JWT_SECRET', STRONG);
      const env = await loadEnv();
      expect(env.JWT_SECRET).toBe(STRONG);
      expect(env.isProd).toBe(true);
    });
  });

  describe('development', () => {
    beforeEach(() => vi.stubEnv('NODE_ENV', 'development'));

    it('warns and falls back to an insecure dev secret instead of crashing', async () => {
      vi.stubEnv('JWT_SECRET', 'your-secret-key');
      const env = await loadEnv();
      expect(console.warn).toHaveBeenCalled();
      expect(env.JWT_SECRET).not.toBe('your-secret-key'); // never the guessable default
      expect(env.isProd).toBe(false);
    });
    it('uses a strong secret as-is, without warning', async () => {
      vi.stubEnv('JWT_SECRET', STRONG);
      const env = await loadEnv();
      expect(env.JWT_SECRET).toBe(STRONG);
      expect(console.warn).not.toHaveBeenCalled();
    });
  });
});

describe('lib/jwt — tokens are signed with the validated secret', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips, and rejects a token forged with the old hardcoded secret', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('JWT_SECRET', STRONG);
    vi.resetModules();
    const { generateToken, verifyToken } = await import('./jwt.js');
    const jsonwebtoken = (await import('jsonwebtoken')).default;

    const token = generateToken({ userId: '7', email: 'a@b.c', roles: ['ADMIN'] });
    expect(verifyToken(token)?.userId).toBe('7');

    const forged = jsonwebtoken.sign({ userId: '1', email: 'x@y.z', roles: ['ADMIN'] }, 'your-secret-key');
    expect(verifyToken(forged)).toBeNull();
  });
});
