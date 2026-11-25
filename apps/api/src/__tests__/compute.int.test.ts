import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  as, createCustomer, createPart, createRfq, createUser, getBinary, prisma, stamp, type TestUser,
} from '../test-support/helpers.js';

let admin: TestUser;
let estimator: TestUser;
let customerId: string;

beforeAll(async () => {
  admin = await createUser('ADMIN');
  estimator = await createUser('ESTIMATOR');
  customerId = (await createCustomer(admin)).id;
});

async function newVersion() {
  const part = await createPart(estimator, customerId);
  return createRfq(estimator, part.id);
}

const compute = (versionId: string, body: Record<string, unknown> = {}) =>
  as(estimator).post(`/rfq-versions/${versionId}/compute`).send(body);

/** A grade/shape/size with its own effective-dated prices, so results never depend on seeded rates. */
async function materialFixture(prices: { rate: number; from: string; to?: string }[]) {
  const s = stamp();
  const post = async (url: string, body: Record<string, unknown>) => {
    const r = await as(admin).post(url).send(body);
    if (r.status !== 201) throw new Error(`${url} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as { id: string };
  };
  const type = await post('/material/types', { name: `ITestSteel ${s}` });
  const grade = await post('/material/categories', { materialTypeId: type.id, gradeCode: `IT${s}`, densityKgM3: 7850 });
  const shape = await post('/material/shapes', { name: `ITestBar ${s}` });
  const size = await post('/material/size-configs', {
    materialCategoryId: grade.id, materialShapeId: shape.id, odMm: 30, lengthMm: 3000, uom: 'kg',
  });
  for (const p of prices) {
    await post('/material/prices', {
      materialSizeConfigId: size.id, ratePerKg: p.rate, effectiveFrom: p.from, ...(p.to ? { effectiveTo: p.to } : {}),
    });
  }
  return { gradeId: grade.id, shapeId: shape.id, sizeId: size.id };
}

describe('material price is resolved as of the costing date (effective-dated masters)', () => {
  it('uses the price in force on the date, and a new price auto-closes the previous one', async () => {
    const m = await materialFixture([
      { rate: 100, from: '2020-01-01' }, // open-ended...
      { rate: 120, from: '2025-01-01' }, // ...until this one is added
    ]);

    // the earlier open row was closed by the later one
    const rows = (await as(admin).get(`/material/prices?materialSizeConfigId=${m.sizeId}`)).body as {
      ratePerKg: string; effectiveFrom: string; effectiveTo: string | null;
    }[];
    const early = rows.find((r) => Number(r.ratePerKg) === 100)!;
    expect(early.effectiveTo).not.toBeNull();
    expect(early.effectiveTo!.slice(0, 10)).toBe('2025-01-01');

    const { versionId } = await newVersion();
    await as(estimator).put(`/rfq-versions/${versionId}`).send({
      partAttributes: { materialCategoryId: m.gradeId, materialShapeId: m.shapeId, netWeightKg: 1, forgingLossPct: 0 },
    });

    // 1 kg of input weight × rate per kg
    expect((await compute(versionId, { persist: false, asOfDate: '2023-06-01' })).body.summary.materialCost).toBe(100);
    expect((await compute(versionId, { persist: false, asOfDate: '2026-06-01' })).body.summary.materialCost).toBe(120);
  });

  it('warns and costs the material at 0 when no price is in force on the date', async () => {
    const m = await materialFixture([{ rate: 100, from: '2020-01-01' }]);
    const { versionId } = await newVersion();
    await as(estimator).put(`/rfq-versions/${versionId}`).send({
      partAttributes: { materialCategoryId: m.gradeId, materialShapeId: m.shapeId, netWeightKg: 2, forgingLossPct: 0 },
    });
    const res = await compute(versionId, { persist: false, asOfDate: '2019-01-01' });
    expect(res.body.summary.materialCost).toBe(0);
    expect(res.body.warnings.join(' ')).toMatch(/No effective material price/i);
  });

  it('applies the forging-loss allowance to the input weight: net × (1 + loss%)', async () => {
    const m = await materialFixture([{ rate: 50, from: '2020-01-01' }]);
    const { versionId } = await newVersion();
    await as(estimator).put(`/rfq-versions/${versionId}`).send({
      partAttributes: { materialCategoryId: m.gradeId, materialShapeId: m.shapeId, netWeightKg: 2, forgingLossPct: 10 },
    });
    const { summary } = (await compute(versionId, { persist: false, asOfDate: '2023-01-01' })).body;
    expect(summary.inputWeightKg).toBeCloseTo(2.2, 6);
    expect(summary.materialCost).toBeCloseTo(110, 2); // 2.2 kg × 50
  });
});

describe('warnings for missing data', () => {
  it('flags a manufactured part with no net weight', async () => {
    const { versionId } = await newVersion();
    const res = await compute(versionId, { persist: false });
    expect(res.status).toBe(200);
    expect(res.body.warnings.join(' ')).toMatch(/Net weight is not set/i);
    expect(res.body.warnings.join(' ')).toMatch(/No process lines/i);
  });

  it('flags a bought-out part with no purchase price', async () => {
    const { versionId } = await newVersion();
    await as(estimator).put(`/rfq-versions/${versionId}`).send({ partAttributes: { sourcingType: 'BOUGHT_OUT' } });
    const res = await compute(versionId, { persist: false });
    expect(res.body.warnings.join(' ')).toMatch(/no purchase price/i);
  });
});

describe('bought-out parts', () => {
  it('use the purchase price as the base cost, with no material weight', async () => {
    const { versionId } = await newVersion();
    await as(estimator).put(`/rfq-versions/${versionId}`).send({
      partAttributes: { sourcingType: 'BOUGHT_OUT', purchasePricePerPc: 250, supplierName: 'ACME Fasteners' },
    });
    const { summary } = (await compute(versionId, { persist: false, quantity: 10 })).body;
    expect(summary.materialCost).toBe(250);
    expect(summary.inputWeightKg).toBe(0);
    expect(summary.quotedPricePerPc).toBeGreaterThanOrEqual(250);
  });
});

describe('persisting and the cost summary', () => {
  async function boughtOut(price = 400) {
    const v = await newVersion();
    await as(estimator).put(`/rfq-versions/${v.versionId}`).send({
      partAttributes: { sourcingType: 'BOUGHT_OUT', purchasePricePerPc: price },
    });
    return v;
  }

  it('persist:false leaves the version untouched; persist:true saves it and moves DRAFT -> COSTED', async () => {
    const { versionId } = await boughtOut();

    await compute(versionId, { persist: false });
    let v = (await as(estimator).get(`/rfq-versions/${versionId}`)).body;
    expect(v.status).toBe('DRAFT');
    expect(v.costSummary).toBeNull();

    const saved = await compute(versionId, { persist: true, quantity: 25 });
    expect(saved.status).toBe(200);
    v = (await as(estimator).get(`/rfq-versions/${versionId}`)).body;
    expect(v.status).toBe('COSTED');
    expect(Number(v.costSummary.totalQuote)).toBeCloseTo(saved.body.summary.totalQuote, 2);
  });

  it('total quote = quoted price per piece × quantity, and the build-up sums', async () => {
    const { versionId } = await boughtOut(400);
    const { summary: s } = (await compute(versionId, { persist: false, quantity: 25 })).body;

    expect(s.totalQuote).toBeCloseTo(s.quotedPricePerPc * 25, 1);
    expect(s.mfgCost).toBeCloseTo(s.materialCost + s.handlingCost + s.machiningCost + s.manualCost + s.subcontractCost + s.qcCost, 1);
    expect(s.subtotal).toBeCloseTo(s.mfgCost + s.adminCost, 1);
    expect(s.quotedPricePerPc).toBeCloseTo(s.subtotal + s.marginAmount, 1);
  });

  it('an estimator margin override of 0% is respected (not treated as "no override")', async () => {
    const { versionId } = await boughtOut(400);
    const { summary: s } = (await compute(versionId, { persist: false, marginOverridePct: 0 })).body;
    expect(s.marginPct).toBe(0);
    expect(s.quotedPricePerPc).toBeCloseTo(s.subtotal, 1);
  });

  it('a margin override replaces the recommended margin; the recommendation is still reported', async () => {
    const { versionId } = await boughtOut(400);
    const { summary: s } = (await compute(versionId, { persist: false, marginOverridePct: 37.5 })).body;
    expect(s.marginPct).toBe(37.5);
    expect(s.quotedPricePerPc).toBeCloseTo(s.subtotal * 1.375, 1);
    expect(s).toHaveProperty('aiRecommendedMarginPct');
  });

  it('records a COMPUTE entry in the audit log with final vs recommended margin', async () => {
    const { versionId } = await boughtOut();
    await compute(versionId, { persist: true, marginOverridePct: 12 });
    const log = (await as(admin).get(`/audit-log?entityType=RfqCostSummary&entityId=${versionId}&action=COMPUTE`)).body as {
      changes: { marginPctFinal: number; overrideApplied: boolean };
    }[];
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].changes).toMatchObject({ marginPctFinal: 12, overrideApplied: true });
  });

  it('404s for an unknown version and 422s for an invalid body', async () => {
    expect((await compute('999999999', {})).status).toBe(404);
    const { versionId } = await boughtOut();
    expect((await compute(versionId, { quantity: -5 })).status).toBe(422);
  });
});

describe('process lines', () => {
  it('replaces the whole set of lines and rejects an unknown process', async () => {
    const { versionId } = await newVersion();
    const proc = await as(admin).post('/processes').send({
      name: `ITest Deburr ${stamp()}`, processType: 'MANUAL', costingMethod: 'FLAT_PC', defaultRate: 7, uom: 'pc',
    });
    expect(proc.status).toBe(201);

    const put = await as(estimator).put(`/rfq-versions/${versionId}/processes`).send({
      lines: [{ processId: proc.body.id, method: 'FLAT_PC', quantityOrTime: 2, rate: 7, sequence: 1 }],
    });
    expect(put.status).toBe(200);
    expect(await prisma.rfqProcess.count({ where: { rfqVersionId: BigInt(versionId) } })).toBe(1);

    // flat per-piece: 2 × ₹7 lands in the manual bucket
    await as(estimator).put(`/rfq-versions/${versionId}`).send({
      partAttributes: { sourcingType: 'BOUGHT_OUT', purchasePricePerPc: 100 },
    });
    const { summary } = (await compute(versionId, { persist: false })).body;
    expect(summary.manualCost).toBeCloseTo(14, 2);

    // replacing with an empty list clears them
    await as(estimator).put(`/rfq-versions/${versionId}/processes`).send({ lines: [] });
    expect(await prisma.rfqProcess.count({ where: { rfqVersionId: BigInt(versionId) } })).toBe(0);
  });
});

describe('the cost-sheet export names the material chosen on the part attributes', () => {
  it('shows the grade code and shape even when no explicit material line exists', async () => {
    const m = await materialFixture([{ rate: 80, from: '2020-01-01' }]);
    const grade = await prisma.materialCategory.findUniqueOrThrow({ where: { id: BigInt(m.gradeId) } });
    const shape = await prisma.materialShape.findUniqueOrThrow({ where: { id: BigInt(m.shapeId) } });

    const { versionId } = await newVersion();
    await as(estimator).put(`/rfq-versions/${versionId}`).send({
      partAttributes: { materialCategoryId: m.gradeId, materialShapeId: m.shapeId, netWeightKg: 1, forgingLossPct: 0 },
    });
    expect((await compute(versionId, { persist: true })).status).toBe(200);

    const res = await getBinary(estimator, `/rfq-versions/${versionId}/cost-sheet.xlsx`);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    const text: string[] = [];
    wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((cell) => typeof cell.value === 'string' && text.push(cell.value))));
    const all = text.join(' | ');
    expect(all).toContain(grade.gradeCode);
    expect(all).toContain(shape.name);
  });
});
