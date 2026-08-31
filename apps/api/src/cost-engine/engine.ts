import {
  CostSummary,
  EngineInput,
  EngineProcessLine,
  EngineProcessResult,
  ProcessType,
} from './types.js';

/** Round to `dp` decimal places, nudging past floating-point noise. */
export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Forged input weight = net × (1 + forging_loss%). */
export function inputWeight(netWeightKg: number, forgingLossPct: number): number {
  return netWeightKg * (1 + forgingLossPct / 100);
}

/** Per-piece cost of a single process line for its costing method (§4.3–4.5). */
export function processLineCost(
  line: EngineProcessLine,
  ctx: { inputWeightKg: number; batchQty: number }
): number {
  const q = line.quantityOrTime || 0;
  const rate = line.rate || 0;
  switch (line.method) {
    case 'CYCLE_TIME':
      return (q / 3600) * rate;
    case 'PER_KG':
      return ctx.inputWeightKg * rate;
    case 'PER_STROKE':
      return q * rate;
    case 'PER_OP':
      return (q || 1) * rate;
    case 'FLAT_PC':
      return (q || 1) * rate;
    case 'PER_LOT':
      return ctx.batchQty > 0 ? rate / ctx.batchQty : rate;
    default:
      return 0;
  }
}

/**
 * The deterministic estimate. Same inputs → same quote. No IO, no clock beyond
 * the caller-supplied `asOfDate`, no LLM.
 */
export function computeCost(input: EngineInput): CostSummary {
  // --- Material (§4.1) ----------------------------------------------------
  const iw = input.material
    ? input.material.inputWeightKgOverride != null && input.material.inputWeightKgOverride > 0
      ? input.material.inputWeightKgOverride
      : inputWeight(input.material.netWeightKg, input.material.forgingLossPct)
    : 0;
  const wastagePct = input.material?.wastagePct ?? 0;
  const materialCost = input.material
    ? iw * (1 + wastagePct / 100) * input.material.ratePerKg
    : 0;

  // --- Handling (§4.2) --------------------------------------------------
  let procurement = 0;
  let transportation = 0;
  let storage = 0;
  if (input.handling) {
    procurement = (materialCost * input.handling.procurementPct) / 100;
    transportation =
      input.handling.transportationUom === 'per_kg'
        ? input.handling.transportationRate * iw
        : input.batchQty > 0
          ? input.handling.transportationRate / input.batchQty
          : input.handling.transportationRate;
    storage = (materialCost * input.handling.storagePct) / 100;
  }
  const handlingCost = procurement + transportation + storage;

  // --- Processes (§4.3–4.5) -------------------------------------------
  const ctx = { inputWeightKg: iw, batchQty: input.batchQty };
  const processes: EngineProcessResult[] = [...input.processes]
    .sort((a, b) => a.sequence - b.sequence)
    .map((line) => ({ ...line, cost: round(processLineCost(line, ctx), 4) }));

  const sumType = (t: ProcessType) =>
    processes.filter((p) => p.processType === t).reduce((s, p) => s + p.cost, 0);
  const machiningCost = sumType('MACHINE');
  const manualCost = sumType('MANUAL');
  const subcontractCost = sumType('SUBCONTRACT');

  // --- QC, auto-derived (§4.6) ---------------------------------------
  const preQc = materialCost + handlingCost + machiningCost + manualCost + subcontractCost;
  let qcCost = 0;
  switch (input.qc.method) {
    case 'PCT_OF_MFG':
      qcCost = (preQc * input.qc.qcPct) / 100;
      break;
    case 'PER_INSPECTION':
      qcCost = Object.values(input.qc.inspectionStandards ?? {}).reduce(
        (s, v) => s + (Number(v) || 0),
        0
      );
      break;
    case 'RULE':
      qcCost = (preQc * (input.qc.qcPct + (input.qc.ruleUpliftPct ?? 0))) / 100;
      break;
  }

  // --- Admin + margin (§4.7) -----------------------------------------
  const mfgCost = preQc + qcCost;
  const adminCost = (mfgCost * input.adminPct) / 100;
  const subtotal = mfgCost + adminCost;

  const aiRecommendedMarginPct = input.baseMarginPct + (input.marginAdjustmentPct ?? 0);
  const marginPct =
    input.marginOverridePct != null && !Number.isNaN(input.marginOverridePct)
      ? input.marginOverridePct
      : aiRecommendedMarginPct;

  const quotedPerPc = subtotal * (1 + marginPct / 100);
  const marginAmount = quotedPerPc - subtotal;
  const totalQuote = quotedPerPc * input.quantity;

  return {
    inputWeightKg: round(iw, 4),
    materialCost: round(materialCost),
    handlingCost: round(handlingCost),
    handling: {
      procurement: round(procurement),
      transportation: round(transportation),
      storage: round(storage),
    },
    machiningCost: round(machiningCost),
    manualCost: round(manualCost),
    subcontractCost: round(subcontractCost),
    qcCost: round(qcCost),
    mfgCost: round(mfgCost),
    adminCost: round(adminCost),
    subtotal: round(subtotal),
    aiRecommendedMarginPct: round(aiRecommendedMarginPct, 4),
    marginPct: round(marginPct, 4),
    marginAmount: round(marginAmount),
    quotedPricePerPc: round(quotedPerPc),
    totalQuote: round(totalQuote),
    processes,
  };
}
