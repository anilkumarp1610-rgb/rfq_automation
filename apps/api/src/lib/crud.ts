import { Router, Response } from 'express';
import { ZodSchema } from 'zod';
import { authenticateToken, canEditMasters, AuthRequest } from '../middleware/auth.js';
import { validateBody } from './validate.js';
import { ah, bigIntParam, notFound } from './http.js';
import { audit } from './audit.js';

/**
 * Prisma model delegates carry heavily-overloaded signatures that don't unify
 * under one structural type, so the factory accepts them loosely.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Delegate = any;

interface CrudOptions {
  /** zod schema for create/update bodies */
  schema: ZodSchema;
  /** default ordering, e.g. { name: 'asc' } */
  orderBy?: unknown;
  /** relations to include on list + get */
  include?: unknown;
  /** columns to `contains`-match against `?search=` */
  searchFields?: string[];
  /** soft-delete via `isActive:false` instead of a hard delete */
  softDelete?: boolean;
  /** filter list to `isActive:true` unless `?activeOnly=false` (soft-delete models) */
  activeFilter?: boolean;
  /** entity label for 404s */
  label: string;
  /** extra data merged into every create (e.g. computed fields) */
  transform?: (body: Record<string, unknown>) => Record<string, unknown>;
  /** string fields that must be coerced to BigInt for Prisma (FK ids) */
  bigIntFields?: string[];
  /**
   * For effective-dated rate masters: on create, close any still-open
   * (`effectiveTo == null`) active row for the same key by stamping its
   * `effectiveTo` with the new row's `effectiveFrom`. `true` = one global
   * timeline; an array names the key columns (e.g. `['materialSizeConfigId']`).
   */
  closePriorOn?: true | string[];
}

function coerceBigInts(body: Record<string, unknown>, fields: string[] = []): Record<string, unknown> {
  const out = { ...body };
  for (const f of fields) {
    const v = out[f];
    if (v === '' || v === undefined) delete out[f];
    else if (v === null) out[f] = null;
    else if (typeof v === 'string' || typeof v === 'number') out[f] = BigInt(v);
  }
  return out;
}

export function crudRouter(getDelegate: () => Delegate, opts: CrudOptions): Router {
  const router = Router();
  router.use(authenticateToken);
  const label = opts.label;

  router.get(
    '/',
    ah(async (req: AuthRequest, res: Response) => {
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const activeOnly = opts.activeFilter && req.query.activeOnly !== 'false';
      const where: Record<string, unknown> = {};
      if (activeOnly) where.isActive = true;
      if (search && opts.searchFields?.length) {
        where.OR = opts.searchFields.map((f) => ({ [f]: { contains: search } }));
      }
      const rows = await getDelegate().findMany({
        where,
        orderBy: opts.orderBy,
        include: opts.include,
      });
      res.json(rows);
    })
  );

  router.get(
    '/:id',
    ah(async (req: AuthRequest, res: Response) => {
      const row = await getDelegate().findUnique({
        where: { id: bigIntParam(req.params.id) },
        include: opts.include,
      });
      if (!row) notFound(label);
      res.json(row);
    })
  );

  router.post(
    '/',
    canEditMasters,
    validateBody(opts.schema),
    ah(async (req: AuthRequest, res: Response) => {
      const data = coerceBigInts(
        opts.transform ? opts.transform(req.body) : req.body,
        opts.bigIntFields
      );
      if (opts.closePriorOn && data.effectiveFrom) {
        const where: Record<string, unknown> = { isActive: true, effectiveTo: null };
        if (Array.isArray(opts.closePriorOn)) {
          for (const k of opts.closePriorOn) where[k] = data[k] ?? null;
        }
        await getDelegate().updateMany({ where, data: { effectiveTo: data.effectiveFrom } });
      }
      const row = await getDelegate().create({ data });
      await audit(req, { entityType: label, entityId: row.id, action: 'CREATE', changes: req.body });
      res.status(201).json(row);
    })
  );

  router.put(
    '/:id',
    canEditMasters,
    validateBody(opts.schema),
    ah(async (req: AuthRequest, res: Response) => {
      const data = coerceBigInts(
        opts.transform ? opts.transform(req.body) : req.body,
        opts.bigIntFields
      );
      const id = bigIntParam(req.params.id);
      const row = await getDelegate().update({ where: { id }, data });
      await audit(req, { entityType: label, entityId: id, action: 'UPDATE', changes: req.body });
      res.json(row);
    })
  );

  router.delete(
    '/:id',
    canEditMasters,
    ah(async (req: AuthRequest, res: Response) => {
      const id = bigIntParam(req.params.id);
      const where = { id };
      if (opts.softDelete) {
        await getDelegate().update({ where, data: { isActive: false } });
      } else {
        await getDelegate().delete({ where });
      }
      await audit(req, { entityType: label, entityId: id, action: 'DELETE' });
      res.status(204).end();
    })
  );

  return router;
}
