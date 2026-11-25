import { RfqPartAttributesInput } from '@rfq/shared';
import { bigIntOrNull, badRequest } from './http.js';
import { prisma } from './prisma.js';

/**
 * Map the shared `RfqPartAttributesInput` onto Prisma `RfqPartAttributes` data.
 * Notably the Prisma field is `forgiveLossPct` (column `forging_loss_pct`).
 * Only keys present in the input are emitted, so partial updates stay partial.
 */
export function toPartAttributesData(input: RfqPartAttributesInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const has = (k: keyof RfqPartAttributesInput) => k in input && input[k] !== undefined;

  if (has('sourcingType')) out.sourcingType = input.sourcingType;
  if (has('purchasePricePerPc')) out.purchasePricePerPc = input.purchasePricePerPc ?? null;
  if (has('supplierName')) out.supplierName = input.supplierName ?? null;
  if (has('materialCategoryId')) out.materialCategoryId = bigIntOrNull(input.materialCategoryId);
  if (has('materialShapeId')) out.materialShapeId = bigIntOrNull(input.materialShapeId);
  if (has('productTypeId')) out.productTypeId = bigIntOrNull(input.productTypeId);
  if (has('netWeightKg')) out.netWeightKg = input.netWeightKg ?? null;
  if (has('forgingLossPct')) out.forgiveLossPct = input.forgingLossPct ?? null;
  if (has('dimensions')) out.dimensions = input.dimensions ?? null;
  if (has('tolerances')) out.tolerances = input.tolerances ?? null;
  if (has('surfaceFinish')) out.surfaceFinish = input.surfaceFinish ?? null;
  if (has('hardness')) out.hardness = input.hardness ?? null;
  if (has('heatTreatment')) out.heatTreatment = input.heatTreatment ?? null;
  if (has('features')) out.features = input.features ?? null;
  if (has('reviewed')) out.reviewed = !!input.reviewed;

  return out;
}

/**
 * The category / shape / product-type columns are real foreign keys, so an unknown id would fail
 * with a bare constraint error. Check up front and say which reference is wrong (422).
 */
export async function assertAttributeRefsExist(data: Record<string, unknown>): Promise<void> {
  const checks: [string, string, () => Promise<unknown>][] = [];
  const id = (k: string) => data[k] as bigint | null | undefined;
  if (id('materialCategoryId'))
    checks.push(['materialCategoryId', 'material grade', () => prisma.materialCategory.findUnique({ where: { id: id('materialCategoryId')! } })]);
  if (id('materialShapeId'))
    checks.push(['materialShapeId', 'material shape', () => prisma.materialShape.findUnique({ where: { id: id('materialShapeId')! } })]);
  if (id('productTypeId'))
    checks.push(['productTypeId', 'product type', () => prisma.productType.findUnique({ where: { id: id('productTypeId')! } })]);
  for (const [, label, find] of checks) {
    if (!(await find())) badRequest(`Unknown ${label} — pick one from the list`, 422);
  }
}
