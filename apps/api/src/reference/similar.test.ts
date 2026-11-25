import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  rfqReference: { findMany: vi.fn() },
  productType: { findMany: vi.fn() },
  materialCategory: { findMany: vi.fn() },
}));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));

import { findSimilar, proximity, scoreReference, type SimilarTarget } from './similar.js';

const dims = (o: Partial<Record<'netWeightKg' | 'maxOdMm' | 'overallLengthMm' | 'acrossFlatsMm', number | null>> = {}) => ({
  netWeightKg: null, maxOdMm: null, overallLengthMm: null, acrossFlatsMm: null, ...o,
});
const target = (o: Partial<SimilarTarget> = {}): SimilarTarget => ({
  partId: 1n, productTypeId: null, materialCategoryId: null, dims: dims(), ...o,
});
const ref = (o: Partial<Parameters<typeof scoreReference>[1]> = {}) => ({
  productTypeId: null, materialCategoryId: null, outcome: 'QUOTED', dims: null, ...o,
});

describe('proximity', () => {
  it('is 1 for equal values and decays toward 0 as they diverge', () => {
    expect(proximity(50, 50)).toBe(1);
    expect(proximity(50, 25)).toBeCloseTo(0.5, 10); // 1 - 25/50
    expect(proximity(100, 1)).toBeCloseTo(0.01, 10);
  });

  it('is symmetric', () => {
    expect(proximity(30, 40)).toBeCloseTo(proximity(40, 30), 12);
  });

  it('is 0 when either value is missing or not positive (nothing to compare)', () => {
    expect(proximity(null, 10)).toBe(0);
    expect(proximity(10, null)).toBe(0);
    expect(proximity(null, null)).toBe(0);
    expect(proximity(0, 10)).toBe(0);
    expect(proximity(10, -2)).toBe(0);
  });

  it('never goes below 0', () => {
    expect(proximity(1, 1_000_000)).toBeGreaterThanOrEqual(0);
  });
});

describe('scoreReference — the weights', () => {
  it('scores 0 when nothing is shared', () => {
    expect(scoreReference(target(), ref())).toBe(0);
  });

  it('+3 for the same product type', () => {
    expect(scoreReference(target({ productTypeId: 5n }), ref({ productTypeId: 5n }))).toBe(3);
  });

  it('+3 for the same material grade', () => {
    expect(scoreReference(target({ materialCategoryId: 9n }), ref({ materialCategoryId: 9n }))).toBe(3);
  });

  it('a different product type or grade scores nothing', () => {
    expect(scoreReference(target({ productTypeId: 5n, materialCategoryId: 9n }), ref({ productTypeId: 6n, materialCategoryId: 8n }))).toBe(0);
  });

  it('missing ids on either side never count as a match', () => {
    expect(scoreReference(target({ productTypeId: null }), ref({ productTypeId: null }))).toBe(0);
    expect(scoreReference(target({ productTypeId: 5n }), ref({ productTypeId: null }))).toBe(0);
    expect(scoreReference(target({ productTypeId: null }), ref({ productTypeId: 5n }))).toBe(0);
  });

  it.each([
    ['net weight', 'netWeightKg', 2.5],
    ['max OD', 'maxOdMm', 1.5],
    ['overall length', 'overallLengthMm', 1.5],
    ['across flats', 'acrossFlatsMm', 0.5],
  ] as const)('identical %s earns its full weight (%f)', (_label, key, weight) => {
    expect(scoreReference(target({ dims: dims({ [key]: 40 }) }), ref({ dims: dims({ [key]: 40 }) }))).toBe(weight);
  });

  it('partially similar dimensions earn proportionally less', () => {
    // 20 vs 40 -> proximity 0.5 -> 0.5 × 2.5
    expect(scoreReference(target({ dims: dims({ netWeightKg: 20 }) }), ref({ dims: dims({ netWeightKg: 40 }) }))).toBe(1.25);
  });

  it('+0.25 only for a WON quote', () => {
    expect(scoreReference(target(), ref({ outcome: 'WON' }))).toBe(0.25);
    expect(scoreReference(target(), ref({ outcome: 'LOST' }))).toBe(0);
    expect(scoreReference(target(), ref({ outcome: 'QUOTED' }))).toBe(0);
  });

  it('a perfect match scores the documented maximum of 12.25', () => {
    const d = dims({ netWeightKg: 1, maxOdMm: 22, overallLengthMm: 45, acrossFlatsMm: 19 });
    expect(scoreReference(target({ productTypeId: 1n, materialCategoryId: 2n, dims: d }), ref({ productTypeId: 1n, materialCategoryId: 2n, outcome: 'WON', dims: d }))).toBe(12.25);
  });

  it('treats a reference with no stored dimensions as "unknown", not as zero-similar-to-everything', () => {
    expect(scoreReference(target({ dims: dims({ maxOdMm: 22 }) }), ref({ dims: null }))).toBe(0);
  });

  it('compares ids by value (a bigint from one query equals one from another)', () => {
    expect(scoreReference(target({ productTypeId: BigInt('12') }), ref({ productTypeId: BigInt(12) }))).toBe(3);
  });

  it('is rounded to 3 decimals', () => {
    const s = scoreReference(target({ dims: dims({ maxOdMm: 22 }) }), ref({ dims: dims({ maxOdMm: 23 }) }));
    expect(s).toBe(Number(s.toFixed(3)));
    expect(String(s).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
  });

  it('ranks a closer part above a further one (the point of the whole feature)', () => {
    const t = target({ dims: dims({ netWeightKg: 1.0, maxOdMm: 22 }) });
    const close = scoreReference(t, ref({ dims: dims({ netWeightKg: 1.1, maxOdMm: 22 }) }));
    const far = scoreReference(t, ref({ dims: dims({ netWeightKg: 5, maxOdMm: 60 }) }));
    expect(close).toBeGreaterThan(far);
  });
});

// ---------------------------------------------------------------------------------------------
// findSimilar — the selection logic around the score, with the database faked.
// ---------------------------------------------------------------------------------------------
interface FakeRef {
  id: bigint; versionId: bigint; partId: bigint; productTypeId?: bigint | null; materialCategoryId?: bigint | null;
  outcome?: string; keyDims?: string | null; quoted?: string; actual?: string | null; partNumber?: string;
}
const fakeRef = (o: FakeRef) => ({
  id: o.id,
  rfqVersionId: o.versionId,
  productTypeId: o.productTypeId ?? null,
  materialCategoryId: o.materialCategoryId ?? null,
  outcome: o.outcome ?? 'QUOTED',
  keyDims: o.keyDims ?? null,
  quotedPricePerPc: o.quoted ?? '100',
  actualCost: o.actual ?? null,
  rfqVersion: {
    revisionNo: 2,
    rfq: {
      rfqNumber: `2026/11/${o.id}`,
      customerPartId: o.partId,
      customerPart: { customerPartNumber: o.partNumber ?? `P${o.partId}`, partName: 'A part', customer: { code: 'SEPL' } },
    },
  },
});

function seed(refs: ReturnType<typeof fakeRef>[]) {
  db.rfqReference.findMany.mockResolvedValue(refs);
  db.productType.findMany.mockResolvedValue([{ id: 5n, name: 'Shaft' }]);
  db.materialCategory.findMany.mockResolvedValue([{ id: 9n, gradeCode: 'EN8' }]);
}

describe('findSimilar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('excludes the target part itself', async () => {
    seed([
      fakeRef({ id: 1n, versionId: 1n, partId: 1n, productTypeId: 5n }), // the part being estimated
      fakeRef({ id: 2n, versionId: 2n, partId: 2n, productTypeId: 5n }),
    ]);
    const rows = await findSimilar(target({ partId: 1n, productTypeId: 5n }), 10);
    expect(rows.map((r) => r.referenceId)).toEqual(['2']);
  });

  it('drops candidates that share nothing (score 0)', async () => {
    seed([
      fakeRef({ id: 2n, versionId: 2n, partId: 2n, productTypeId: 5n }),
      fakeRef({ id: 3n, versionId: 3n, partId: 3n, productTypeId: 77n }),
    ]);
    const rows = await findSimilar(target({ productTypeId: 5n }), 10);
    expect(rows.map((r) => r.referenceId)).toEqual(['2']);
  });

  it('orders best match first and honours the limit', async () => {
    seed([
      fakeRef({ id: 2n, versionId: 2n, partId: 2n, productTypeId: 5n }), // 3
      fakeRef({ id: 3n, versionId: 3n, partId: 3n, productTypeId: 5n, materialCategoryId: 9n }), // 6
      fakeRef({ id: 4n, versionId: 4n, partId: 4n, productTypeId: 5n, materialCategoryId: 9n, outcome: 'WON' }), // 6.25
    ]);
    const all = await findSimilar(target({ productTypeId: 5n, materialCategoryId: 9n }), 10);
    expect(all.map((r) => r.referenceId)).toEqual(['4', '3', '2']);
    expect(all.map((r) => r.score)).toEqual([6.25, 6, 3]);

    const top1 = await findSimilar(target({ productTypeId: 5n, materialCategoryId: 9n }), 1);
    expect(top1.map((r) => r.referenceId)).toEqual(['4']);
  });

  it('a WON quote beats an otherwise identical unproven one', async () => {
    seed([
      fakeRef({ id: 2n, versionId: 2n, partId: 2n, productTypeId: 5n, outcome: 'QUOTED' }),
      fakeRef({ id: 3n, versionId: 3n, partId: 3n, productTypeId: 5n, outcome: 'WON' }),
    ]);
    const rows = await findSimilar(target({ productTypeId: 5n }), 10);
    expect(rows[0].referenceId).toBe('3');
  });

  it('shapes each row for the UI: names resolved, numbers converted, dims parsed', async () => {
    seed([
      fakeRef({
        id: 2n, versionId: 22n, partId: 2n, productTypeId: 5n, materialCategoryId: 9n, outcome: 'WON',
        keyDims: JSON.stringify(dims({ netWeightKg: 1.2, maxOdMm: 22 })), quoted: '123.45', actual: '110', partNumber: 'P01273549',
      }),
    ]);
    const [row] = await findSimilar(target({ productTypeId: 5n, dims: dims({ netWeightKg: 1.2 }) }), 5);
    expect(row).toMatchObject({
      referenceId: '2', rfqVersionId: '22', rfqNumber: '2026/11/2', revisionNo: 2,
      customerPartNumber: 'P01273549', partName: 'A part', customerCode: 'SEPL',
      productType: 'Shaft', materialGrade: 'EN8', outcome: 'WON',
      quotedPricePerPc: 123.45, actualCost: 110, samePart: false,
    });
    expect(row.keyDims).toMatchObject({ netWeightKg: 1.2, maxOdMm: 22 });
  });

  it('survives a corrupt keyDims blob (treated as no dimensions) instead of throwing', async () => {
    seed([fakeRef({ id: 2n, versionId: 2n, partId: 2n, productTypeId: 5n, keyDims: '{not json' })]);
    const rows = await findSimilar(target({ productTypeId: 5n }), 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].keyDims).toBeNull();
  });

  it('reports null for an actual cost that was never entered, and 0 for an unparseable quote', async () => {
    seed([fakeRef({ id: 2n, versionId: 2n, partId: 2n, productTypeId: 5n, actual: null, quoted: 'oops' })]);
    const [row] = await findSimilar(target({ productTypeId: 5n }), 5);
    expect(row.actualCost).toBeNull();
    expect(row.quotedPricePerPc).toBe(0);
  });

  it('returns an empty list when there is no history', async () => {
    seed([]);
    expect(await findSimilar(target({ productTypeId: 5n }), 10)).toEqual([]);
  });

  it('only looks up names for ids that are actually referenced', async () => {
    seed([fakeRef({ id: 2n, versionId: 2n, partId: 2n, productTypeId: 5n, materialCategoryId: null })]);
    await findSimilar(target({ productTypeId: 5n }), 5);
    expect(db.productType.findMany).toHaveBeenCalledWith({ where: { id: { in: [5n] } } });
    expect(db.materialCategory.findMany).toHaveBeenCalledWith({ where: { id: { in: [] } } });
  });
});
