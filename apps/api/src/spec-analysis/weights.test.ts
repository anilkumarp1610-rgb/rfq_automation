import { describe, expect, it } from 'vitest';
import { deriveWeights } from './weights.js';

/** Minimal extraction: only the fields deriveWeights reads. */
type Extract = Parameters<typeof deriveWeights>[0];
const item = (itemType: string, nominalValue: unknown) => ({ itemType, nominalValue });
const extract = (header: Record<string, unknown>, items: unknown[] = []): Extract =>
  ({ header, items }) as unknown as Extract;

// Reference values (steel, ρ = 7850 kg/m³): m = π/4 · d² · L · ρ
//   Ø22 × 45 mm → 0.13428 kg      Ø26 × 84 mm → 0.35009 kg   (the two worked drawings in the plan)

describe('deriveWeights — input (bar stock) weight', () => {
  it('is the bounding cylinder max OD × overall length', () => {
    const w = deriveWeights(extract({ maxOdMm: 22, overallLengthMm: 45 }));
    expect(w.estInputWeightKg).toBeCloseTo(0.1343, 4);
  });

  it('matches the second worked drawing (Ø26 × 84)', () => {
    expect(deriveWeights(extract({ maxOdMm: 26, overallLengthMm: 84 })).estInputWeightKg).toBeCloseTo(0.3501, 4);
  });

  it('scales linearly with density', () => {
    const steel = deriveWeights(extract({ maxOdMm: 22, overallLengthMm: 45 }), 7850).estInputWeightKg!;
    const alu = deriveWeights(extract({ maxOdMm: 22, overallLengthMm: 45 }), 2700).estInputWeightKg!;
    expect(alu / steel).toBeCloseTo(2700 / 7850, 3);
  });

  it('defaults to steel (7850 kg/m³)', () => {
    const a = deriveWeights(extract({ maxOdMm: 22, overallLengthMm: 45 }));
    const b = deriveWeights(extract({ maxOdMm: 22, overallLengthMm: 45 }), 7850);
    expect(a.estInputWeightKg).toBe(b.estInputWeightKg);
  });

  it('scales with the square of the diameter and linearly with length', () => {
    const base = deriveWeights(extract({ maxOdMm: 10, overallLengthMm: 100 })).estInputWeightKg!;
    expect(deriveWeights(extract({ maxOdMm: 20, overallLengthMm: 100 })).estInputWeightKg! / base).toBeCloseTo(4, 2);
    expect(deriveWeights(extract({ maxOdMm: 10, overallLengthMm: 200 })).estInputWeightKg! / base).toBeCloseTo(2, 2);
  });

  it('is rounded to 4 decimal places', () => {
    const w = deriveWeights(extract({ maxOdMm: 22, overallLengthMm: 45 }));
    expect(w.estInputWeightKg).toBe(Number(w.estInputWeightKg!.toFixed(4)));
  });
});

describe('deriveWeights — net weight', () => {
  it('uses the mean of the captured diameters as an effective diameter', () => {
    // Ø22 and Ø18 -> mean Ø20 over 45 mm
    const w = deriveWeights(extract({ maxOdMm: 22, overallLengthMm: 45 }, [item('DIAMETER', 22), item('DIAMETER', 18)]));
    expect(w.estNetWeightKg).toBeCloseTo(0.111, 3);
  });

  it('is never more than the input weight', () => {
    const stepped = deriveWeights(extract({ maxOdMm: 22, overallLengthMm: 45 }, [item('DIAMETER', 22), item('DIAMETER', 10)]));
    expect(stepped.estNetWeightKg!).toBeLessThan(stepped.estInputWeightKg!);

    // a captured diameter larger than the stated max OD cannot make the part heavier than its bar
    const odd = deriveWeights(extract({ maxOdMm: 22, overallLengthMm: 45 }, [item('DIAMETER', 40)]));
    expect(odd.estNetWeightKg).toBe(odd.estInputWeightKg);
  });

  it('equals the input weight when every diameter is the max OD', () => {
    const w = deriveWeights(extract({ maxOdMm: 22, overallLengthMm: 45 }, [item('DIAMETER', 22), item('DIAMETER', 22)]));
    expect(w.estNetWeightKg).toBe(w.estInputWeightKg);
  });

  it('assumes 90 % of the max OD when no diameters were captured', () => {
    const w = deriveWeights(extract({ maxOdMm: 22, overallLengthMm: 45 }));
    expect(w.estNetWeightKg).toBeCloseTo(0.1088, 4); // Ø19.8 × 45
    expect(w.basis).toContain('effective Ø19.8');
  });
});

describe('deriveWeights — where the geometry comes from', () => {
  it('prefers the header values over item values', () => {
    const w = deriveWeights(extract({ maxOdMm: 22, overallLengthMm: 45 }, [item('DIAMETER', 99), item('LENGTH', 999)]));
    expect(w.estInputWeightKg).toBeCloseTo(0.1343, 4);
  });

  it('falls back to the largest DIAMETER and LENGTH items when the header has none', () => {
    const w = deriveWeights(extract({}, [item('DIAMETER', 10), item('DIAMETER', 26), item('LENGTH', 20), item('LENGTH', 84)]));
    expect(w.estInputWeightKg).toBeCloseTo(0.3501, 4); // Ø26 × 84
  });

  it('can mix: max OD from the header, length from the items', () => {
    const w = deriveWeights(extract({ maxOdMm: 26 }, [item('LENGTH', 84)]));
    expect(w.estInputWeightKg).toBeCloseTo(0.3501, 4);
  });

  it('ignores zero, negative, missing and non-numeric values', () => {
    const w = deriveWeights(
      extract({}, [
        item('DIAMETER', 0), item('DIAMETER', -5), item('DIAMETER', null), item('DIAMETER', '22'), item('DIAMETER', 22),
        item('LENGTH', 0), item('LENGTH', undefined), item('LENGTH', 45),
      ])
    );
    expect(w.estInputWeightKg).toBeCloseTo(0.1343, 4);
  });

  it('only DIAMETER items count as diameters and only LENGTH items as lengths', () => {
    const w = deriveWeights(extract({}, [item('THREAD', 30), item('HOLE', 40), item('DIAMETER', 22), item('LENGTH', 45)]));
    expect(w.estInputWeightKg).toBeCloseTo(0.1343, 4);
  });
});

describe('deriveWeights — not enough information', () => {
  it.each([
    ['nothing at all', extract({}, [])],
    ['a diameter but no length', extract({ maxOdMm: 22 }, [])],
    ['a length but no diameter', extract({ overallLengthMm: 45 }, [])],
    ['only unusable values', extract({ maxOdMm: 0, overallLengthMm: 0 }, [item('DIAMETER', 0)])],
  ])('returns nulls and says so for %s', (_label, ex) => {
    expect(deriveWeights(ex)).toEqual({
      estNetWeightKg: null,
      estInputWeightKg: null,
      basis: 'insufficient geometry on drawing',
    });
  });
});

describe('deriveWeights — the explanation', () => {
  it('records how the number was reached, so an estimator can sanity-check it', () => {
    const { basis } = deriveWeights(extract({ maxOdMm: 22, overallLengthMm: 45 }), 7850);
    expect(basis).toContain('Ø22×45');
    expect(basis).toContain('ρ=7850');
  });
});
