import { Request, Response, NextFunction, RequestHandler } from 'express';

/** Wrap an async route handler so rejected promises reach the error middleware. */
export function ah(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Parse a numeric route param into a BigInt, or throw a 400. */
export function bigIntParam(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    const err = new Error('Invalid id') as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  return BigInt(value);
}

/** Throw a not-found error to be handled by the error middleware. */
export function notFound(entity: string): never {
  const err = new Error(`${entity} not found`) as Error & { status?: number };
  err.status = 404;
  throw err;
}

/** Throw a generic client error. */
export function badRequest(message: string, status = 400): never {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  throw err;
}

/** `"12"` -> 12n, `null`/`undefined`/`""` -> null. */
export function bigIntOrNull(v: unknown): bigint | null {
  if (v === null || v === undefined || v === '') return null;
  return BigInt(v as string | number);
}

/**
 * Copy `body`, converting the named fields to BigInt (or null). Fields left
 * `undefined` in the body are dropped so Prisma treats them as "no change".
 */
export function withBigInts<T extends Record<string, unknown>>(
  body: T,
  fields: (keyof T)[]
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  for (const f of fields) {
    const key = f as string;
    if (!(key in out) || out[key] === undefined) {
      delete out[key];
      continue;
    }
    out[key] = bigIntOrNull(out[key]);
  }
  return out;
}
