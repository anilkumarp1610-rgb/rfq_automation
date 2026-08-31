import { z } from 'zod';
import { RfqStatus, RfqVersionStatus, CostingMethod, SourcingType } from './enums';
import { specExtractResult } from './spec';

const optionalStr = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .or(z.literal('').transform(() => undefined));
const idString = z.string().regex(/^\d+$/, 'must be a numeric id');

// ---------------------------------------------------------------------------
// Customer part
// ---------------------------------------------------------------------------
export const customerPartSchema = z.object({
  customerId: idString,
  customerPartNumber: z.string().trim().min(1, 'Part number is required').max(120),
  partName: z.string().trim().min(1, 'Part name is required').max(200),
  productTypeId: idString.nullish(),
  drawingNo: optionalStr,
  currentRevision: optionalStr,
});
export type CustomerPartInput = z.infer<typeof customerPartSchema>;

// ---------------------------------------------------------------------------
// RFQ part attributes (per version)
// ---------------------------------------------------------------------------
export const rfqPartAttributesSchema = z.object({
  /** MANUFACTURED → costed by the engine · BOUGHT_OUT → procured, costed from purchase price */
  sourcingType: SourcingType.optional(),
  purchasePricePerPc: z.coerce.number().nonnegative().nullish(),
  supplierName: optionalStr,
  materialCategoryId: idString.nullish(),
  materialShapeId: idString.nullish(),
  productTypeId: idString.nullish(),
  netWeightKg: z.coerce.number().positive().nullish(),
  forgingLossPct: z.coerce.number().min(0).max(100).nullish(),
  dimensions: optionalStr,
  tolerances: optionalStr,
  surfaceFinish: optionalStr,
  hardness: optionalStr,
  heatTreatment: optionalStr,
  features: optionalStr,
  reviewed: z.coerce.boolean().optional(),
});
export type RfqPartAttributesInput = z.infer<typeof rfqPartAttributesSchema>;

// ---------------------------------------------------------------------------
// RFQ (header) + first version
// ---------------------------------------------------------------------------
export const rfqCreateSchema = z.object({
  /** omit to auto-generate `YYYY/MM/NNNN` */
  rfqNumber: z.string().trim().max(60).optional(),
  customerPartId: idString,
  rfqDate: z.coerce.date().default(() => new Date()),
  requiredDate: z.coerce.date().nullish(),
  annualQty: z.coerce.number().nonnegative().nullish(),
  batchQty: z.coerce.number().nonnegative().nullish(),
  currency: z.string().trim().length(3).default('INR'),
  versionLabel: optionalStr,
  basedOnPartRevision: optionalStr,
});
export type RfqCreateInput = z.infer<typeof rfqCreateSchema>;

export const rfqUpdateSchema = z.object({
  requiredDate: z.coerce.date().nullish(),
  annualQty: z.coerce.number().nonnegative().nullish(),
  batchQty: z.coerce.number().nonnegative().nullish(),
  currency: z.string().trim().length(3).optional(),
  status: RfqStatus.optional(),
});
export type RfqUpdateInput = z.infer<typeof rfqUpdateSchema>;

// ---------------------------------------------------------------------------
// RFQ version
// ---------------------------------------------------------------------------
export const rfqVersionCreateSchema = z.object({
  versionLabel: optionalStr,
  basedOnPartRevision: optionalStr,
  /** copy part attributes from this existing version id */
  copyFromVersionId: idString.nullish(),
});
export type RfqVersionCreateInput = z.infer<typeof rfqVersionCreateSchema>;

export const rfqVersionUpdateSchema = z.object({
  versionLabel: optionalStr,
  basedOnPartRevision: optionalStr,
  status: RfqVersionStatus.optional(),
  makeCurrent: z.coerce.boolean().optional(),
  partAttributes: rfqPartAttributesSchema.optional(),
});
export type RfqVersionUpdateInput = z.infer<typeof rfqVersionUpdateSchema>;

// ---------------------------------------------------------------------------
// Cost sheet — process lines, material line, compute request
// ---------------------------------------------------------------------------
export const rfqProcessLineSchema = z.object({
  processId: idString,
  machineId: idString.nullish(),
  method: CostingMethod.optional(),
  quantityOrTime: z.coerce.number().nonnegative().default(0),
  rate: z.coerce.number().nonnegative().default(0),
  sequence: z.coerce.number().int().nonnegative().default(0),
});
export type RfqProcessLineInput = z.infer<typeof rfqProcessLineSchema>;

/** Replace the whole set of process lines for a version. */
export const rfqProcessesSchema = z.object({
  lines: z.array(rfqProcessLineSchema),
});
export type RfqProcessesInput = z.infer<typeof rfqProcessesSchema>;

/** Set (or clear, with null) the single material line for a version. */
export const rfqMaterialSchema = z.object({
  line: z
    .object({
      materialSizeConfigId: idString,
      inputWeightKg: z.coerce.number().positive(),
      ratePerKg: z.coerce.number().nonnegative(),
      wastagePct: z.coerce.number().min(0).max(100).default(0),
    })
    .nullable(),
});
export type RfqMaterialInput = z.infer<typeof rfqMaterialSchema>;

// ---------------------------------------------------------------------------
// History / reference
// ---------------------------------------------------------------------------
export const referenceOutcome = z.enum(['QUOTED', 'WON', 'LOST']);
export type ReferenceOutcome = z.infer<typeof referenceOutcome>;

export const rfqReferenceSchema = z.object({
  outcome: referenceOutcome.optional(),
  actualCost: z.coerce.number().nonnegative().nullish(),
});
export type RfqReferenceInput = z.infer<typeof rfqReferenceSchema>;

export const similarQuerySchema = z.object({
  partId: idString.optional(),
  versionId: idString.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type SimilarQueryInput = z.infer<typeof similarQuerySchema>;

// ---------------------------------------------------------------------------
// Create RFQ from a spec drawing (wizard)
// ---------------------------------------------------------------------------
export const rfqFromSpecSchema = z.object({
  /** the extraction returned by the preview step — reused so the AI is not called twice */
  extract: specExtractResult,
  /** whether that extraction was the deterministic mock (no API key) */
  mock: z.coerce.boolean().default(false),
  partNumber: z.string().trim().min(1, 'Part number is required').max(120),
  partName: z.string().trim().min(1, 'Part name is required').max(200),
  revision: z.string().trim().max(20).default('R00'),
  sourcingType: SourcingType.default('MANUFACTURED'),
  purchasePricePerPc: z.coerce.number().nonnegative().nullish(),
  supplierName: optionalStr,
  customerId: idString.optional(),
  /** used when customerId is absent — a customer is created with rating 3 */
  newCustomerName: z.string().trim().max(200).optional(),
  productTypeId: idString.nullish(),
  materialCategoryId: idString.nullish(),
  materialShapeId: idString.nullish(),
  forgingLossPct: z.coerce.number().min(0).max(100).default(12),
  annualQty: z.coerce.number().nonnegative().nullish(),
  batchQty: z.coerce.number().nonnegative().nullish(),
  requiredDate: z.coerce.date().nullish(),
  currency: z.string().trim().length(3).default('INR'),
  versionLabel: optionalStr,
  /** must be true to add a revision when the part already has an RFQ */
  confirmRevision: z.coerce.boolean().default(false),
  /** auto-suggest process + material lines from the spec */
  autoLines: z.coerce.boolean().default(true),
});
export type RfqFromSpecInput = z.infer<typeof rfqFromSpecSchema>;

export const computeRequestSchema = z.object({
  asOfDate: z.coerce.date().optional(),
  quantity: z.coerce.number().positive().optional(),
  marginAdjustmentPct: z.coerce.number().min(-100).max(100).optional(),
  marginOverridePct: z.coerce.number().min(0).max(100).nullish(),
  /** persist the result to rfq_cost_summary (default true) */
  persist: z.coerce.boolean().optional().default(true),
});
export type ComputeRequestInput = z.infer<typeof computeRequestSchema>;
