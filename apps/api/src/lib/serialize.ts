/**
 * Express `res.json` cannot serialize BigInt (Prisma ids) or Prisma Decimal.
 * Patch both to emit JSON-friendly values:
 *   - BigInt  -> string  (matches the shared zod schemas that treat ids as strings)
 *   - Decimal -> number
 * Import this module once, before any route is registered.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export {};
