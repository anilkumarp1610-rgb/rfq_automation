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

export type TransportationMode = 'PER_KG' | 'PER_LOT' | 'FIXED' | 'PCT';
export type CostMode = 'FIXED' | 'PCT';

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
  storagePct: number;
  /** PER_KG · PER_LOT · FIXED (₹/pc) · PCT (% of the base / purchase cost) */
  transportationMode: TransportationMode;
  transportationRate: number;
  /** FIXED (₹/pc) · PCT (% of the base / purchase cost) */
  packingMode: CostMode;
  packingCost: number;
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

export interface EngineBoughtOut {
  /** the procurement price for the finished / assembly part */
  purchasePricePerPc: number;
  /** known finished weight, used only for per-kg transportation */
  netWeightKg?: number;
}

export interface EngineInput {
  asOfDate: Date;
  /** pieces the total quote covers */
  quantity: number;
  /** pieces per batch — amortises per-lot costs */
  batchQty: number;
  customerRating: number;

  /**
   * When set, the part is BOUGHT_OUT — its purchase price replaces the material
   * build-up. Handling, QC, admin and margin still apply; process lines are still
   * summed (e.g. incoming inspection / kitting), so leave them empty for a pure
   * buy-and-resell item.
   */
  boughtOut?: EngineBoughtOut | null;

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

/** One "how was this number reached" line inside an {@link ExplainSection}. */
export interface ExplainStep {
  label: string;
  /** already formatted for display — "₹49.50", "0.55 kg", "18%" */
  value?: string;
  note?: string;
}

/** The calculation behind one row of the cost summary, for the UI info popover. */
export interface ExplainSection {
  /** matches the summary row: material · handling · machining · manual · subcontract · qc · mfg · admin · subtotal · margin · quoted · total */
  key: string;
  title: string;
  /** the formula in words, e.g. "input wt × (1 + wastage%) × rate/kg" */
  formula: string;
  steps: ExplainStep[];
  result: number;
}

export interface CostSummary {
  inputWeightKg: number;
  materialCost: number;
  handlingCost: number;
  handling: { procurement: number; transportation: number; storage: number; packing: number };
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
  /** per-section calculation trace — powers the "info" popovers on the cost sheet */
  explain: ExplainSection[];
}
