import { z } from 'zod';
import { SpecItemType } from './enums';

/** 0..1 confidence the model attaches to a field or item. */
const confidence = z.coerce.number().min(0).max(1).nullish();
const str = z.string().trim().max(4000).nullish();
const nzNum = z.coerce.number().nullish();

// ---------------------------------------------------------------------------
// AI extraction contract — the model must return exactly { header, items, flags }
// ---------------------------------------------------------------------------
export const specHeaderExtract = z.object({
  drawingNo: str,
  title: str,
  customerName: str,
  coNo: str,
  revision: str,
  sheetSize: str,
  scale: str,
  materialNote: str,
  designedBy: str,
  detailedBy: str,
  checkedBy: str,
  drawnDate: str,
  productType: str,
  overallLengthMm: nzNum,
  maxOdMm: nzNum,
  acrossFlatsMm: nzNum,
  sectionView: str,
  generalTolTable: z.any().nullish(),
  notes: str,
  confidence,
});
export type SpecHeaderExtract = z.infer<typeof specHeaderExtract>;

export const specItemExtract = z.object({
  itemType: SpecItemType,
  label: str,
  nominalValue: nzNum,
  unit: str,
  tolUpper: nzNum,
  tolLower: nzNum,
  tolClass: str,
  datum: str,
  gdtType: str,
  rawText: str,
  confidence,
});
export type SpecItemExtract = z.infer<typeof specItemExtract>;

export const specExtractResult = z.object({
  header: specHeaderExtract,
  items: z.array(specItemExtract).default([]),
  /** free-text notes about missing / ambiguous data the estimator must resolve */
  flags: z.array(z.string()).default([]),
});
export type SpecExtractResult = z.infer<typeof specExtractResult>;

// ---------------------------------------------------------------------------
// Estimator review / correction
// ---------------------------------------------------------------------------
export const specItemReview = specItemExtract.extend({
  id: z.string().regex(/^\d+$/).optional(),
  reviewed: z.coerce.boolean().optional(),
  /** mark an item for deletion on save */
  remove: z.coerce.boolean().optional(),
});
export type SpecItemReview = z.infer<typeof specItemReview>;

export const specReviewSchema = z.object({
  header: specHeaderExtract.partial().optional(),
  estNetWeightKg: z.coerce.number().nonnegative().nullish(),
  estInputWeightKg: z.coerce.number().nonnegative().nullish(),
  notes: str,
  reviewed: z.coerce.boolean().optional(),
  items: z.array(specItemReview).optional(),
});
export type SpecReviewInput = z.infer<typeof specReviewSchema>;

// ---------------------------------------------------------------------------
// Push derived data from a reviewed spec onto the RFQ version's part attributes
// ---------------------------------------------------------------------------
export const specApplySchema = z.object({
  netWeightKg: z.coerce.boolean().optional().default(true),
  materialNote: z.coerce.boolean().optional().default(true),
  productType: z.coerce.boolean().optional().default(true),
});
export type SpecApplyInput = z.infer<typeof specApplySchema>;
