import { describe, it, expect } from 'vitest';
import { computeCost, inputWeight, processLineCost, round } from './engine.js';
import { EngineInput, EngineProcessLine } from './types.js';

const baseInput = (over: Partial<EngineInput> = {}): EngineInput => ({
  asOfDate: new Date('2026-01-01'),
  quantity: 1,
  batchQty: 100,
  customerRating: 3,
  material: null,
  handling: null,
  processes: [],
  qc: { method: 'PCT_OF_MFG', qcPct: 0 },
  adminPct: 0,
  baseMarginPct: 0,
  ...over,
});

describe('helpers', () => {
  it('round nudges past float noise', () => {
    expect(round(0.1 + 0.2)).toBe(0.3);
    expect(round(1.005)).toBe(1.01);
    expect(round(2.34567, 3)).toBe(2.346);
  });

  it('inputWeight applies the forging loss allowance', () => {
    expect(inputWeight(1, 10)).toBeCloseTo(1.1, 10);
    expect(inputWeight(0.34, 10)).toBeCloseTo(0.374, 10);
    expect(inputWeight(5, 0)).toBe(5);
  });
});

describe('processLineCost — each costing method', () => {
  const ctx = { inputWeightKg: 1.2, batchQty: 50 };
  const line = (over: Partial<EngineProcessLine>): EngineProcessLine => ({
    sequence: 1,
    name: 'op',
    processType: 'MACHINE',
    method: 'FLAT_PC',
    quantityOrTime: 0,
    rate: 0,
    ...over,
  });

  it('CYCLE_TIME: (seconds / 3600) * hourly rate', () => {
    expect(processLineCost(line({ method: 'CYCLE_TIME', quantityOrTime: 3600, rate: 200 }), ctx)).toBe(200);
    expect(processLineCost(line({ method: 'CYCLE_TIME', quantityOrTime: 180, rate: 600 }), ctx)).toBe(30);
  });

  it('PER_KG: input weight * rate/kg (quantity ignored)', () => {
    expect(processLineCost(line({ method: 'PER_KG', rate: 22, quantityOrTime: 999 }), ctx)).toBeCloseTo(26.4, 10);
  });

  it('PER_STROKE: strokes * rate', () => {
    expect(processLineCost(line({ method: 'PER_STROKE', quantityOrTime: 5, rate: 12 }), ctx)).toBe(60);
  });

  it('PER_OP: count (default 1) * standard rate', () => {
    expect(processLineCost(line({ method: 'PER_OP', rate: 45 }), ctx)).toBe(45);
    expect(processLineCost(line({ method: 'PER_OP', quantityOrTime: 3, rate: 45 }), ctx)).toBe(135);
  });

  it('FLAT_PC: count (default 1) * rate/pc', () => {
    expect(processLineCost(line({ method: 'FLAT_PC', rate: 8 }), ctx)).toBe(8);
    expect(processLineCost(line({ method: 'FLAT_PC', quantityOrTime: 2, rate: 8 }), ctx)).toBe(16);
  });

  it('PER_LOT: rate / batch qty', () => {
    expect(processLineCost(line({ method: 'PER_LOT', rate: 1000 }), ctx)).toBe(20);
    expect(processLineCost(line({ method: 'PER_LOT', rate: 1000 }), { ...ctx, batchQty: 0 })).toBe(1000);
  });
});

describe('computeCost — material & handling', () => {
  it('material cost = input weight * rate, wastage compounds', () => {
    const r = computeCost(
      baseInput({ material: { netWeightKg: 2, forgingLossPct: 0, ratePerKg: 100 }, quantity: 10 })
    );
    expect(r.inputWeightKg).toBe(2);
    expect(r.materialCost).toBe(200);
    expect(r.quotedPricePerPc).toBe(200);
    expect(r.totalQuote).toBe(2000);
  });

  it('an explicit input-weight override wins over net × (1 + loss)', () => {
    const r = computeCost(
      baseInput({
        material: {
          netWeightKg: 0.14,
          forgingLossPct: 12,
          ratePerKg: 120,
          wastagePct: 3,
          inputWeightKgOverride: 0.16,
        },
      })
    );
    expect(r.inputWeightKg).toBe(0.16);
    expect(r.materialCost).toBe(19.78); // 0.16 * 1.03 * 120 = 19.776
  });

  it('wastage % adds on top of the forging allowance', () => {
    const r = computeCost(
      baseInput({ material: { netWeightKg: 1, forgingLossPct: 10, ratePerKg: 100, wastagePct: 5 } })
    );
    // 1 * 1.1 * 1.05 * 100
    expect(r.materialCost).toBe(115.5);
  });

  it('handling: per_kg transportation', () => {
    const r = computeCost(
      baseInput({
        material: { netWeightKg: 1, forgingLossPct: 20, ratePerKg: 100 }, // iw 1.2, matCost 120
        handling: { procurementPct: 10, transportationRate: 10, transportationMode: 'PER_KG', storagePct: 5, packingMode: 'FIXED', packingCost: 0 },
      })
    );
    // procurement 12, transport 10*1.2=12, storage 6
    expect(r.handling).toEqual({ procurement: 12, transportation: 12, storage: 6, packing: 0 });
    expect(r.handlingCost).toBe(30);
  });

  it('handling: per_lot transportation is amortised by batch qty', () => {
    const r = computeCost(
      baseInput({
        batchQty: 200,
        material: { netWeightKg: 1, forgingLossPct: 0, ratePerKg: 100 },
        handling: { procurementPct: 0, transportationRate: 4000, transportationMode: 'PER_LOT', storagePct: 0, packingMode: 'FIXED', packingCost: 0 },
      })
    );
    expect(r.handling.transportation).toBe(20);
  });

  it('transportation FIXED and packing FIXED are flat ₹/pc; both default to 0', () => {
    const base = { netWeightKg: 1, forgingLossPct: 0, ratePerKg: 100 };
    const zero = computeCost(
      baseInput({
        material: base,
        handling: { procurementPct: 0, storagePct: 0, transportationMode: 'FIXED', transportationRate: 0, packingMode: 'FIXED', packingCost: 0 },
      })
    );
    expect(zero.handlingCost).toBe(0);

    const flat = computeCost(
      baseInput({
        material: base,
        handling: { procurementPct: 0, storagePct: 0, transportationMode: 'FIXED', transportationRate: 3.5, packingMode: 'FIXED', packingCost: 2 },
      })
    );
    expect(flat.handling).toEqual({ procurement: 0, transportation: 3.5, storage: 0, packing: 2 });
    expect(flat.handlingCost).toBe(5.5);
  });

  it('transportation PCT and packing PCT are a % of the material / purchase base', () => {
    const r = computeCost(
      baseInput({
        material: { netWeightKg: 1, forgingLossPct: 0, ratePerKg: 100 }, // matCost 100
        handling: { procurementPct: 0, storagePct: 0, transportationMode: 'PCT', transportationRate: 4, packingMode: 'PCT', packingCost: 1.5 },
      })
    );
    expect(r.handling.transportation).toBe(4); // 4% of 100
    expect(r.handling.packing).toBe(1.5); // 1.5% of 100
  });
});

describe('computeCost — bought-out / procured part', () => {
  it('purchase price replaces the material build-up; handling/QC/admin/margin still apply', () => {
    const r = computeCost(
      baseInput({
        boughtOut: { purchasePricePerPc: 100 },
        // material is ignored when boughtOut is set
        material: { netWeightKg: 5, forgingLossPct: 50, ratePerKg: 999 },
        handling: { procurementPct: 10, transportationRate: 0, transportationMode: 'PER_LOT', storagePct: 5, packingMode: 'FIXED', packingCost: 0 },
        qc: { method: 'PCT_OF_MFG', qcPct: 4 },
        adminPct: 10,
        baseMarginPct: 20,
      })
    )
    expect(r.inputWeightKg).toBe(0)
    expect(r.materialCost).toBe(100)
    // handling on the purchase price: 10% + 5% = 15
    expect(r.handlingCost).toBe(15)
    expect(r.machiningCost).toBe(0)
    // preQc 115, qc 4% = 4.6 -> mfg 119.6, admin 10% = 11.96, subtotal 131.56, +20% margin
    expect(r.qcCost).toBe(4.6)
    expect(r.subtotal).toBe(131.56)
    expect(r.quotedPricePerPc).toBe(157.87)
  })

  it('per-kg transportation uses the bought-out net weight when given', () => {
    const r = computeCost(
      baseInput({
        boughtOut: { purchasePricePerPc: 50, netWeightKg: 2 },
        handling: { procurementPct: 0, transportationRate: 3, transportationMode: 'PER_KG', storagePct: 0, packingMode: 'FIXED', packingCost: 0 },
      })
    )
    expect(r.handling.transportation).toBe(6) // 3 * 2
  })

  it('assembly / inspection process lines are still added on top of the purchase price', () => {
    const r = computeCost(
      baseInput({
        boughtOut: { purchasePricePerPc: 100 },
        processes: [
          { sequence: 1, name: 'Incoming test', processType: 'MANUAL', method: 'FLAT_PC', quantityOrTime: 1, rate: 12 },
        ],
      })
    )
    expect(r.materialCost).toBe(100)
    expect(r.manualCost).toBe(12)
  })
})

describe('computeCost — QC auto-derivation', () => {
  const withCosts = (qc: EngineInput['qc']) =>
    computeCost(
      baseInput({
        material: { netWeightKg: 1, forgingLossPct: 0, ratePerKg: 100 }, // 100
        processes: [
          { sequence: 1, name: 'turn', processType: 'MACHINE', method: 'FLAT_PC', quantityOrTime: 1, rate: 50 },
        ],
        qc,
      })
    );

  it('PCT_OF_MFG: % of (material+handling+machining+manual+subcontract)', () => {
    const r = withCosts({ method: 'PCT_OF_MFG', qcPct: 5 });
    expect(r.qcCost).toBe(7.5); // 5% of 150
  });

  it('PER_INSPECTION: sum of the named inspection costs', () => {
    const r = withCosts({
      method: 'PER_INSPECTION',
      qcPct: 0,
      inspectionStandards: { fai: 2, inProcess: 1.5, final: 1, cmm: 3, certificate: 0.5 },
    });
    expect(r.qcCost).toBe(8);
  });

  it('RULE: base % plus uplift %', () => {
    const r = withCosts({ method: 'RULE', qcPct: 4, ruleUpliftPct: 2 });
    expect(r.qcCost).toBe(9); // 6% of 150
  });
});

describe('computeCost — margin', () => {
  const subtotalOnly = baseInput({
    material: { netWeightKg: 1, forgingLossPct: 0, ratePerKg: 100 },
    adminPct: 0,
  });

  it('uses base + adjustment when there is no override', () => {
    const r = computeCost({ ...subtotalOnly, baseMarginPct: 25, marginAdjustmentPct: 5 });
    expect(r.aiRecommendedMarginPct).toBe(30);
    expect(r.marginPct).toBe(30);
    expect(r.quotedPricePerPc).toBe(130);
    expect(r.marginAmount).toBe(30);
  });

  it('override wins over base + adjustment but recommendation is still recorded', () => {
    const r = computeCost({
      ...subtotalOnly,
      baseMarginPct: 25,
      marginAdjustmentPct: 5,
      marginOverridePct: 18,
    });
    expect(r.aiRecommendedMarginPct).toBe(30);
    expect(r.marginPct).toBe(18);
    expect(r.quotedPricePerPc).toBe(118);
  });

  it('override of 0 is respected (not treated as absent)', () => {
    const r = computeCost({ ...subtotalOnly, baseMarginPct: 25, marginOverridePct: 0 });
    expect(r.marginPct).toBe(0);
    expect(r.quotedPricePerPc).toBe(100);
  });
});

describe('computeCost — full build-up integration', () => {
  const input = baseInput({
    quantity: 500,
    batchQty: 100,
    customerRating: 4,
    material: { netWeightKg: 1, forgingLossPct: 20, ratePerKg: 100 }, // iw 1.2 · matCost 120
    handling: { procurementPct: 10, transportationRate: 10, transportationMode: 'PER_KG', storagePct: 5, packingMode: 'FIXED', packingCost: 0 }, // 30
    processes: [
      { sequence: 2, name: 'CNC turning', processType: 'MACHINE', method: 'CYCLE_TIME', quantityOrTime: 3600, rate: 200 }, // 200
      { sequence: 1, name: 'Deburr', processType: 'MANUAL', method: 'FLAT_PC', quantityOrTime: 1, rate: 15 }, // 15
      { sequence: 3, name: 'Heat treat', processType: 'SUBCONTRACT', method: 'PER_LOT', quantityOrTime: 0, rate: 1000 }, // 10
    ],
    qc: { method: 'PCT_OF_MFG', qcPct: 4 }, // 4% of 375 = 15
    adminPct: 10, // 10% of 390 = 39
    baseMarginPct: 25,
    marginAdjustmentPct: 5, // 30%
  });

  it('produces the expected cost sheet', () => {
    const r = computeCost(input);
    expect(r.materialCost).toBe(120);
    expect(r.handlingCost).toBe(30);
    expect(r.machiningCost).toBe(200);
    expect(r.manualCost).toBe(15);
    expect(r.subcontractCost).toBe(10);
    expect(r.qcCost).toBe(15);
    expect(r.mfgCost).toBe(390);
    expect(r.adminCost).toBe(39);
    expect(r.subtotal).toBe(429);
    expect(r.marginPct).toBe(30);
    expect(r.marginAmount).toBe(128.7);
    expect(r.quotedPricePerPc).toBe(557.7);
    expect(r.totalQuote).toBe(278850);
  });

  it('returns process lines sorted by sequence with per-line cost', () => {
    const r = computeCost(input);
    expect(r.processes.map((p) => p.name)).toEqual(['Deburr', 'CNC turning', 'Heat treat']);
    expect(r.processes.map((p) => p.cost)).toEqual([15, 200, 10]);
  });

  it('is deterministic — same inputs, same output', () => {
    expect(computeCost(input)).toEqual(computeCost(input));
  });

  it('emits an explain section per cost-sheet row, each result matching the summary', () => {
    const r = computeCost(input);
    const keys = r.explain.map((s) => s.key);
    expect(keys).toEqual([
      'material', 'handling', 'machining', 'manual', 'subcontract',
      'qc', 'mfg', 'admin', 'subtotal', 'margin', 'quoted', 'total',
    ]);
    const by = Object.fromEntries(r.explain.map((s) => [s.key, s.result]));
    expect(by.material).toBe(r.materialCost);
    expect(by.handling).toBe(r.handlingCost);
    expect(by.machining).toBe(r.machiningCost);
    expect(by.qc).toBe(r.qcCost);
    expect(by.mfg).toBe(r.mfgCost);
    expect(by.subtotal).toBe(r.subtotal);
    expect(by.margin).toBe(r.marginAmount);
    expect(by.quoted).toBe(r.quotedPricePerPc);
    expect(by.total).toBe(r.totalQuote);
  });

  it('explains a bought-out part as a purchase cost, not a material build-up', () => {
    const r = computeCost({ ...input, material: null, boughtOut: { purchasePricePerPc: 250 } });
    const mat = r.explain.find((s) => s.key === 'material')!;
    expect(mat.title).toBe('Purchase cost');
    expect(mat.result).toBe(250);
  });
});
