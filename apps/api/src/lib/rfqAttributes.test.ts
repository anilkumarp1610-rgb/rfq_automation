import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  materialCategory: { findUnique: vi.fn() },
  materialShape: { findUnique: vi.fn() },
  productType: { findUnique: vi.fn() },
}));
vi.mock('./prisma.js', () => ({ prisma: db }));

import { assertAttributeRefsExist, toPartAttributesData } from './rfqAttributes.js';

describe('toPartAttributesData — mapping', () => {
  it('maps the shared field forgingLossPct onto the Prisma field forgiveLossPct', () => {
    const out = toPartAttributesData({ forgingLossPct: 12 });
    expect(out).toEqual({ forgiveLossPct: 12 });
    expect(out).not.toHaveProperty('forgingLossPct');
  });

  it('converts id strings to bigint', () => {
    expect(toPartAttributesData({ materialCategoryId: '7', materialShapeId: '8', productTypeId: '9' })).toEqual({
      materialCategoryId: 7n, materialShapeId: 8n, productTypeId: 9n,
    });
  });

  it('passes plain fields through unchanged', () => {
    const input = {
      sourcingType: 'BOUGHT_OUT' as const, purchasePricePerPc: 250, supplierName: 'ACME', netWeightKg: 1.25,
      dimensions: '{"od":22}', tolerances: 't', surfaceFinish: 'ZN', hardness: '45 HRC', heatTreatment: 'Q&T', features: 'f',
    };
    expect(toPartAttributesData(input)).toEqual(input);
  });
});

describe('toPartAttributesData — partial updates stay partial', () => {
  it('emits nothing for an empty input', () => {
    expect(toPartAttributesData({})).toEqual({});
  });

  it('emits only the keys that were sent, so unsent columns are not wiped', () => {
    expect(Object.keys(toPartAttributesData({ hardness: '45 HRC' }))).toEqual(['hardness']);
  });

  it('treats an explicit undefined as "not sent"', () => {
    expect(toPartAttributesData({ hardness: undefined, surfaceFinish: 'ZN' })).toEqual({ surfaceFinish: 'ZN' });
  });
});

describe('toPartAttributesData — clearing a value', () => {
  it('null clears a reference', () => {
    expect(toPartAttributesData({ materialCategoryId: null, productTypeId: null })).toEqual({ materialCategoryId: null, productTypeId: null });
  });

  it('an empty-string id also clears it (a cleared <select>)', () => {
    expect(toPartAttributesData({ materialShapeId: '' as never })).toEqual({ materialShapeId: null });
  });

  it('null clears a number or text field', () => {
    expect(toPartAttributesData({ purchasePricePerPc: null, netWeightKg: null, supplierName: undefined, forgingLossPct: null }))
      .toEqual({ purchasePricePerPc: null, netWeightKg: null, forgiveLossPct: null });
  });

  it('zero is a real value, not "clear" — a 0% forging loss must be kept', () => {
    expect(toPartAttributesData({ forgingLossPct: 0, purchasePricePerPc: 0 })).toEqual({ forgiveLossPct: 0, purchasePricePerPc: 0 });
  });
});

describe('toPartAttributesData — the reviewed flag', () => {
  it('is a real boolean either way', () => {
    expect(toPartAttributesData({ reviewed: true })).toEqual({ reviewed: true });
    expect(toPartAttributesData({ reviewed: false })).toEqual({ reviewed: false });
  });
});

describe('assertAttributeRefsExist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.materialCategory.findUnique.mockResolvedValue({ id: 1n });
    db.materialShape.findUnique.mockResolvedValue({ id: 1n });
    db.productType.findUnique.mockResolvedValue({ id: 1n });
  });

  const rejection = async (data: Record<string, unknown>) => {
    try {
      await assertAttributeRefsExist(data);
    } catch (e) {
      return e as Error & { status?: number };
    }
    throw new Error('expected a rejection');
  };

  it('passes when every referenced row exists', async () => {
    await expect(assertAttributeRefsExist({ materialCategoryId: 1n, materialShapeId: 2n, productTypeId: 3n })).resolves.toBeUndefined();
  });

  it('looks each reference up by its own id in its own table', async () => {
    await assertAttributeRefsExist({ materialCategoryId: 11n, materialShapeId: 22n, productTypeId: 33n });
    expect(db.materialCategory.findUnique).toHaveBeenCalledWith({ where: { id: 11n } });
    expect(db.materialShape.findUnique).toHaveBeenCalledWith({ where: { id: 22n } });
    expect(db.productType.findUnique).toHaveBeenCalledWith({ where: { id: 33n } });
  });

  it('does not query at all for cleared (null) or unsent references', async () => {
    await assertAttributeRefsExist({ materialCategoryId: null, hardness: 'x' });
    await assertAttributeRefsExist({});
    expect(db.materialCategory.findUnique).not.toHaveBeenCalled();
    expect(db.materialShape.findUnique).not.toHaveBeenCalled();
    expect(db.productType.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['materialCategory', 'materialCategoryId', /material grade/i],
    ['materialShape', 'materialShapeId', /material shape/i],
    ['productType', 'productTypeId', /product type/i],
  ] as const)('rejects an unknown %s with a 422 that names it', async (table, field, label) => {
    db[table].findUnique.mockResolvedValue(null);
    const err = await rejection({ [field]: 999n });
    expect(err.status).toBe(422);
    expect(err.message).toMatch(label);
    expect(err.message).toMatch(/pick one/i);
  });

  it('reports the first bad reference', async () => {
    db.materialShape.findUnique.mockResolvedValue(null);
    db.productType.findUnique.mockResolvedValue(null);
    const err = await rejection({ materialShapeId: 5n, productTypeId: 6n });
    expect(err.message).toMatch(/material shape/i);
  });
});
