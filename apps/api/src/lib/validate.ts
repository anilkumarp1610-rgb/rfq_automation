import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/** Validate `req.body` against a zod schema; replaces body with the parsed value. */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({ error: 'Validation failed', issues: flatten(result.error) });
    }
    req.body = result.data;
    next();
  };
}

/** Validate `req.query` against a zod schema; stashes the parsed value on `res.locals.query`. */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(422).json({ error: 'Validation failed', issues: flatten(result.error) });
    }
    res.locals.query = result.data;
    next();
  };
}

function flatten(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}
