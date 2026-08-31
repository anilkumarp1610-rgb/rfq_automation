import { z } from 'zod';
import {
  CostingMethod,
  ProcessType,
  QcMethod,
  TransportationUom,
} from './enums';
import { money, pct } from './common';

const optionalStr = z.string().trim().max(500).optional().or(z.literal('').transform(() => undefined));

/** `effectiveTo`, when given, must not precede `effectiveFrom`. */
const validEffectiveRange = (v: { effectiveFrom: Date; effectiveTo?: Date | null }) =>
  !v.effectiveTo || v.effectiveTo >= v.effectiveFrom;
const effectiveRangeMsg = {
  message: 'effectiveTo must be on or after effectiveFrom',
  path: ['effectiveTo'],
};

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------
export const customerSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(50),
  name: z.string().trim().min(1, 'Name is required').max(200),
  rating: z.coerce.number().int().min(1).max(5).default(3),
  commercialScore: z.coerce.number().min(0).max(100).nullish(),
  paymentTerms: optionalStr,
  currency: z.string().trim().length(3).default('INR'),
  gstNo: optionalStr,
  taxApplicable: z.coerce.boolean().default(true),
  deliveryLocation: optionalStr,
  address: optionalStr,
  contactName: optionalStr,
  contactEmail: z.string().email().optional().or(z.literal('').transform(() => undefined)),
});
export type CustomerInput = z.infer<typeof customerSchema>;

// ---------------------------------------------------------------------------
// Product type
// ---------------------------------------------------------------------------
export const productTypeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalStr,
});
export type ProductTypeInput = z.infer<typeof productTypeSchema>;

// ---------------------------------------------------------------------------
// Material hierarchy
// ---------------------------------------------------------------------------
export const materialTypeSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type MaterialTypeInput = z.infer<typeof materialTypeSchema>;

export const materialCategorySchema = z.object({
  materialTypeId: z.string().regex(/^\d+$/),
  gradeCode: z.string().trim().min(1).max(60),
  description: optionalStr,
  densityKgM3: z.coerce.number().positive().default(7850),
});
export type MaterialCategoryInput = z.infer<typeof materialCategorySchema>;

export const materialShapeSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type MaterialShapeInput = z.infer<typeof materialShapeSchema>;

export const materialSizeConfigSchema = z.object({
  materialCategoryId: z.string().regex(/^\d+$/),
  materialShapeId: z.string().regex(/^\d+$/),
  odMm: z.coerce.number().positive().nullish(),
  idMm: z.coerce.number().nonnegative().nullish(),
  widthMm: z.coerce.number().positive().nullish(),
  thicknessMm: z.coerce.number().positive().nullish(),
  lengthMm: z.coerce.number().positive().nullish(),
  uom: z.string().trim().min(1).max(10).default('kg'),
  standardWeightPerUnit: z.coerce.number().positive().nullish(),
});
export type MaterialSizeConfigInput = z.infer<typeof materialSizeConfigSchema>;

export const materialPriceSchema = z.object({
  materialSizeConfigId: z.string().regex(/^\d+$/),
  ratePerKg: money,
  currency: z.string().trim().length(3).default('INR'),
  supplier: optionalStr,
  moq: z.coerce.number().nonnegative().nullish(),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullish(),
}).refine(validEffectiveRange, effectiveRangeMsg);
export type MaterialPriceInput = z.infer<typeof materialPriceSchema>;

export const handlingConfigSchema = z.object({
  materialTypeId: z.string().regex(/^\d+$/).nullish(),
  procurementPct: pct,
  transportationRate: money,
  transportationUom: TransportationUom.default('per_lot'),
  storagePct: pct,
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullish(),
}).refine(validEffectiveRange, effectiveRangeMsg);
export type HandlingConfigInput = z.infer<typeof handlingConfigSchema>;

// ---------------------------------------------------------------------------
// Process & machine
// ---------------------------------------------------------------------------
export const processSchema = z.object({
  name: z.string().trim().min(1).max(150),
  processType: ProcessType,
  costingMethod: CostingMethod,
  defaultRate: z.coerce.number().nonnegative().nullish(),
  uom: z.string().trim().min(1).max(15),
  description: optionalStr,
});
export type ProcessInput = z.infer<typeof processSchema>;

export const machineSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(80),
  depreciationHr: money.default(0),
  powerHr: money.default(0),
  maintenanceHr: money.default(0),
  operatorHr: money.default(0),
  toolingHr: money.default(0),
  overheadHr: money.default(0),
});
export type MachineInput = z.infer<typeof machineSchema>;

/** machine_hour_rate build-up — kept in sync on the server. */
export function machineHourRate(m: {
  depreciationHr: number;
  powerHr: number;
  maintenanceHr: number;
  operatorHr: number;
  toolingHr: number;
  overheadHr: number;
}): number {
  return (
    m.depreciationHr +
    m.powerHr +
    m.maintenanceHr +
    m.operatorHr +
    m.toolingHr +
    m.overheadHr
  );
}

// ---------------------------------------------------------------------------
// QC / overhead / margin map
// ---------------------------------------------------------------------------
export const qcConfigSchema = z.object({
  method: QcMethod.default('PCT_OF_MFG'),
  qcPct: pct.default(5),
  inspectionStandards: z.string().optional(),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullish(),
}).refine(validEffectiveRange, effectiveRangeMsg);
export type QcConfigInput = z.infer<typeof qcConfigSchema>;

export const overheadConfigSchema = z.object({
  adminPct: pct,
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullish(),
}).refine(validEffectiveRange, effectiveRangeMsg);
export type OverheadConfigInput = z.infer<typeof overheadConfigSchema>;

export const customerMarginMapSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  baseMarginPct: pct,
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullish(),
}).refine(validEffectiveRange, effectiveRangeMsg);
export type CustomerMarginMapInput = z.infer<typeof customerMarginMapSchema>;
