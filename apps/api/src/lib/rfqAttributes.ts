import { RfqPartAttributesInput } from '@rfq/shared';
import { bigIntOrNull } from './http.js';

/**
 * Map the shared `RfqPartAttributesInput` onto Prisma `RfqPartAttributes` data.
 * Notably the Prisma field is `forgiveLossPct` (column `forging_loss_pct`).
 * Only keys present in the input are emitted, so partial updates stay partial.
 */
export function toPartAttributesData(input: RfqPartAttributesInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const has = (k: keyof RfqPartAttributesInput) => k in input && input[k] !== undefined;

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
