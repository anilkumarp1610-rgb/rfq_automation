/**
 * Cost-engine value types. The engine is a pure function of these inputs — it
 * never touches Prisma, Express or the LLM. See `development.plan` §4.
 */

export type ProcessType = 'MACHINE' | 'MANUAL' | 'SUBCONTRACT';

export type CostingMethod =
  | 'CYCLE_TIME'
  | 'PER_KG'
  | 'PER_STROKE'
  | 'PER_OP'
  | 'FLAT_PC'
  | 'PER_LOT';

export type QcMethod = 'PCT_OF_MFG' | 'PER_INSPECTION' | 'RULE';

export type TransportationUom = 'per_kg' | 'per_lot';

export interface EngineMaterial {
  netWeightKg: number;
  forgingLossPct: number;
  /** ₹/kg resolved from material_prices as of the costing date */
  ratePerKg: number;
  /** extra loss on top of the forging allowance (default 0) */
  wastagePct?: number;
  /**
   * When the estimator has entered an explicit material line (e.g. bar-stock
   * cut weight), that weight overrides the net × (1 + forging_loss%) rule.
   */
  inputWeightKgOverride?: number;
}

export interface EngineHandling {
  procurementPct: number;
  transportationRate: number;
  transportationUom: TransportationUom;
  storagePct: number;
}

export interface EngineProcessLine {
  /** opaque id so the caller can write the computed cost back to the row */
  ref?: string;
  sequence: number;
  name: string;
  processType: ProcessType;
  method: CostingMethod;
  /** seconds for CYCLE_TIME · strokes for PER_STROKE · a count (default 1) otherwise */
  quantityOrTime: number;
  /** machine-hour rate for CYCLE_TIME · ₹/kg · ₹/stroke · ₹/op · ₹/pc · ₹/lot */
  rate: number;
}

export interface EngineQc {
  method: QcMethod;
  qcPct: number;
  /** PER_INSPECTION: named ₹/pc inspection costs that are summed */
  inspectionStandards?: Record<string, number> | null;
  /** RULE: extra % added on top of qcPct for tight-tolerance / critical / new parts */
  ruleUpliftPct?: number;
}

export interface EngineInput {
  asOfDate: Date;
  /** pieces the total quote covers */
  quantity: number;
  /** pieces per batch — amortises per-lot costs */
  batchQty: number;
  customerRating: number;

  material: EngineMaterial | null;
  handling: EngineHandling | null;
  processes: EngineProcessLine[];
  qc: EngineQc;

  adminPct: number;
  /** base margin % from customer_margin_map for the customer rating */
  baseMarginPct: number;
  /** estimator nudge added to the base margin */
  marginAdjustmentPct?: number;
  /** estimator hard override; when set it wins over base + adjustment */
  marginOverridePct?: number | null;
}

export interface EngineProcessResult extends EngineProcessLine {
  cost: number;
}

export interface CostSummary {
  inputWeightKg: number;
  materialCost: number;
  handlingCost: number;
  handling: { procurement: number; transportation: number; storage: number };
  machiningCost: number;
  manualCost: number;
  subcontractCost: number;
  qcCost: number;
  mfgCost: number;
  adminCost: number;
  subtotal: number;
  /** base + adjustment, before any override — stored as the "recommended" value */
  aiRecommendedMarginPct: number;
  marginPct: number;
  marginAmount: number;
  quotedPricePerPc: number;
  totalQuote: number;
  processes: EngineProcessResult[];
}
