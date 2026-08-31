import { z } from 'zod';

/** Numeric-string id coming from the URL (BigInt on the server). */
export const idParam = z.object({
  id: z.string().regex(/^\d+$/, 'id must be numeric'),
});

/** Optional effective-dating fields shared by rate masters. */
export const effectiveDating = z.object({
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullish(),
});

export const listQuery = z.object({
  search: z.string().trim().optional(),
  activeOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (typeof v === 'string' ? v === 'true' : v)),
});
export type ListQuery = z.infer<typeof listQuery>;

/** A positive money/rate value. */
export const money = z.coerce.number().nonnegative();
/** A percentage 0..100. */
export const pct = z.coerce.number().min(0).max(100);
