import {
  CostSummary,
  EngineInput,
  EngineProcessLine,
  EngineProcessResult,
  ExplainSection,
  ExplainStep,
  ProcessType,
} from './types.js';

/** ₹ with up to 2 dp — display only, never fed back into a calculation. */
const inr = (n: number) => `₹${round(n, 2).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const kg = (n: number) => `${round(n, 4)} kg`;
const pct = (n: number) => `${round(n, 4)}%`;

/** Human-readable formula + substituted numbers for one process line. */
function explainLine(l: EngineProcessResult, ctx: { inputWeightKg: number; batchQty: number }): ExplainStep {
  const q = l.quantityOrTime || 0;
  const r = l.rate || 0;
  let how: string;
  switch (l.method) {
    case 'CYCLE_TIME':
      how = `${q}s ÷ 3600 × ${inr(r)}/hr`;
      break;
    case 'PER_KG':
      how = `${kg(ctx.inputWeightKg)} × ${inr(r)}/kg`;
      break;
    case 'PER_STROKE':
      how = `${q} strokes × ${inr(r)}/stroke`;
      break;
    case 'PER_OP':
      how = `${q || 1} op × ${inr(r)}`;
      break;
    case 'FLAT_PC':
      how = `${q || 1} × ${inr(r)}/pc`;
      break;
    case 'PER_LOT':
      how = ctx.batchQty > 0 ? `${inr(r)}/lot ÷ ${ctx.batchQty} pcs` : `${inr(r)}/lot`;
      break;
    default:
      how = '';
  }
  return { label: `${l.name} (${l.method})`, value: inr(l.cost), note: how };
}

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
  // --- Material / purchase base (§4.1) ----------------------------------
  const boughtOut = input.boughtOut ?? null;
  const iw = boughtOut
    ? boughtOut.netWeightKg ?? 0
    : input.material
      ? input.material.inputWeightKgOverride != null && input.material.inputWeightKgOverride > 0
        ? input.material.inputWeightKgOverride
        : inputWeight(input.material.netWeightKg, input.material.forgingLossPct)
      : 0;
  const wastagePct = input.material?.wastagePct ?? 0;
  const materialCost = boughtOut
    ? boughtOut.purchasePricePerPc
    : input.material
      ? iw * (1 + wastagePct / 100) * input.material.ratePerKg
      : 0;

  // --- Handling (§4.2) — procurement, transportation, storage, packing ---
  // "base cost" for the % modes is the material / purchase cost.
  let procurement = 0;
  let transportation = 0;
  let storage = 0;
  let packing = 0;
  if (input.handling) {
    const h = input.handling;
    procurement = (materialCost * h.procurementPct) / 100;
    storage = (materialCost * h.storagePct) / 100;
    switch (h.transportationMode) {
      case 'PER_KG':
        transportation = h.transportationRate * iw;
        break;
      case 'PER_LOT':
        transportation = input.batchQty > 0 ? h.transportationRate / input.batchQty : h.transportationRate;
        break;
      case 'PCT':
        transportation = (materialCost * h.transportationRate) / 100;
        break;
      case 'FIXED':
      default:
        transportation = h.transportationRate;
    }
    packing = h.packingMode === 'PCT' ? (materialCost * h.packingCost) / 100 : h.packingCost;
  }
  const handlingCost = procurement + transportation + storage + packing;

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

  // --- Calculation trace (info popovers on the cost sheet) ------------
  const explain: ExplainSection[] = [];

  if (boughtOut) {
    explain.push({
      key: 'material',
      title: 'Purchase cost',
      formula: 'purchase price / pc (bought-out part)',
      steps: [{ label: 'Purchase price / pc', value: inr(boughtOut.purchasePricePerPc) }],
      result: round(materialCost),
    });
  } else if (input.material) {
    const m = input.material;
    const usedOverride = m.inputWeightKgOverride != null && m.inputWeightKgOverride > 0;
    explain.push({
      key: 'material',
      title: 'Material cost',
      formula: 'input wt × (1 + wastage%) × rate/kg',
      steps: [
        { label: 'Net weight', value: kg(m.netWeightKg) },
        { label: 'Forging loss', value: pct(m.forgingLossPct) },
        {
          label: 'Input weight',
          value: kg(iw),
          note: usedOverride
            ? 'estimator override'
            : `${kg(m.netWeightKg)} × (1 + ${pct(m.forgingLossPct)})`,
        },
        { label: 'Wastage', value: pct(wastagePct) },
        { label: 'Rate / kg', value: inr(m.ratePerKg) },
      ],
      result: round(materialCost),
    });
  }

  {
    const h = input.handling;
    const steps: ExplainStep[] = [];
    if (h) {
      steps.push({
        label: 'Procurement',
        value: inr(procurement),
        note: `${inr(materialCost)} × ${pct(h.procurementPct)}`,
      });
      let tNote: string;
      switch (h.transportationMode) {
        case 'PER_KG':
          tNote = `${kg(iw)} × ${inr(h.transportationRate)}/kg`;
          break;
        case 'PER_LOT':
          tNote =
            input.batchQty > 0
              ? `${inr(h.transportationRate)}/lot ÷ ${input.batchQty} pcs`
              : `${inr(h.transportationRate)}/lot`;
          break;
        case 'PCT':
          tNote = `${inr(materialCost)} × ${pct(h.transportationRate)}`;
          break;
        default:
          tNote = `${inr(h.transportationRate)}/pc (fixed)`;
      }
      steps.push({ label: `Transportation (${h.transportationMode})`, value: inr(transportation), note: tNote });
      steps.push({
        label: 'Storage',
        value: inr(storage),
        note: `${inr(materialCost)} × ${pct(h.storagePct)}`,
      });
      steps.push({
        label: `Packing (${h.packingMode})`,
        value: inr(packing),
        note: h.packingMode === 'PCT' ? `${inr(materialCost)} × ${pct(h.packingCost)}` : `${inr(h.packingCost)}/pc (fixed)`,
      });
    } else {
      steps.push({ label: 'No handling config in effect', value: inr(0) });
    }
    explain.push({
      key: 'handling',
      title: 'Handling cost',
      formula: 'procurement + transportation + storage + packing',
      steps,
      result: round(handlingCost),
    });
  }

  const procSection = (key: string, title: string, type: ProcessType, total: number): ExplainSection => {
    const lines = processes.filter((p) => p.processType === type);
    return {
      key,
      title,
      formula: `sum of ${type} process lines`,
      steps: lines.length
        ? lines.map((l) => explainLine(l, ctx))
        : [{ label: `No ${type} lines`, value: inr(0) }],
      result: round(total),
    };
  };
  explain.push(procSection('machining', 'Machining cost', 'MACHINE', machiningCost));
  explain.push(procSection('manual', 'Manual cost', 'MANUAL', manualCost));
  explain.push(procSection('subcontract', 'Subcontract cost', 'SUBCONTRACT', subcontractCost));

  {
    const steps: ExplainStep[] = [];
    let formula: string;
    if (input.qc.method === 'PER_INSPECTION') {
      formula = 'sum of inspection standard costs';
      for (const [name, v] of Object.entries(input.qc.inspectionStandards ?? {}))
        steps.push({ label: name, value: inr(Number(v) || 0) });
      if (steps.length === 0) steps.push({ label: 'No inspection standards set', value: inr(0) });
    } else {
      const effPct = input.qc.method === 'RULE' ? input.qc.qcPct + (input.qc.ruleUpliftPct ?? 0) : input.qc.qcPct;
      formula =
        input.qc.method === 'RULE'
          ? '(material + handling + processes) × (QC% + rule uplift%)'
          : '(material + handling + processes) × QC%';
      steps.push({ label: 'Pre-QC cost', value: inr(preQc), note: 'material + handling + machining + manual + subcontract' });
      if (input.qc.method === 'RULE') {
        steps.push({ label: 'QC %', value: pct(input.qc.qcPct) });
        steps.push({ label: 'Rule uplift %', value: pct(input.qc.ruleUpliftPct ?? 0) });
      }
      steps.push({ label: 'Effective QC %', value: pct(effPct) });
    }
    explain.push({ key: 'qc', title: 'QC cost (auto)', formula, steps, result: round(qcCost) });
  }

  explain.push({
    key: 'mfg',
    title: 'Manufacturing cost',
    formula: 'material + handling + machining + manual + subcontract + QC',
    steps: [
      { label: 'Material', value: inr(materialCost) },
      { label: 'Handling', value: inr(handlingCost) },
      { label: 'Machining', value: inr(machiningCost) },
      { label: 'Manual', value: inr(manualCost) },
      { label: 'Subcontract', value: inr(subcontractCost) },
      { label: 'QC', value: inr(qcCost) },
    ],
    result: round(mfgCost),
  });

  explain.push({
    key: 'admin',
    title: 'Administration',
    formula: 'manufacturing cost × admin%',
    steps: [
      { label: 'Manufacturing cost', value: inr(mfgCost) },
      { label: 'Admin %', value: pct(input.adminPct) },
    ],
    result: round(adminCost),
  });

  explain.push({
    key: 'subtotal',
    title: 'Subtotal',
    formula: 'manufacturing cost + administration',
    steps: [
      { label: 'Manufacturing cost', value: inr(mfgCost) },
      { label: 'Administration', value: inr(adminCost) },
    ],
    result: round(subtotal),
  });

  {
    const steps: ExplainStep[] = [
      { label: 'Base margin %', value: pct(input.baseMarginPct), note: 'from customer rating' },
      { label: 'Adjustment %', value: pct(input.marginAdjustmentPct ?? 0) },
    ];
    if (input.marginOverridePct != null && !Number.isNaN(input.marginOverridePct))
      steps.push({ label: 'Override %', value: pct(input.marginOverridePct), note: 'wins over base + adjustment' });
    steps.push({ label: 'Effective margin %', value: pct(marginPct) });
    steps.push({ label: 'Subtotal', value: inr(subtotal) });
    explain.push({
      key: 'margin',
      title: 'Margin',
      formula: 'subtotal × effective margin%',
      steps,
      result: round(marginAmount),
    });
  }

  explain.push({
    key: 'quoted',
    title: 'Quoted price / pc',
    formula: 'subtotal + margin',
    steps: [
      { label: 'Subtotal', value: inr(subtotal) },
      { label: 'Margin', value: inr(marginAmount) },
    ],
    result: round(quotedPerPc),
  });

  explain.push({
    key: 'total',
    title: 'Total quote',
    formula: 'quoted price / pc × quantity',
    steps: [
      { label: 'Quoted price / pc', value: inr(quotedPerPc) },
      { label: 'Quantity', value: String(input.quantity) },
    ],
    result: round(totalQuote),
  });

  return {
    inputWeightKg: round(iw, 4),
    materialCost: round(materialCost),
    handlingCost: round(handlingCost),
    handling: {
      procurement: round(procurement),
      transportation: round(transportation),
      storage: round(storage),
      packing: round(packing),
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
    explain,
  };
}
