import { SpecExtractResult } from '@rfq/shared';
import { round } from '../cost-engine/engine.js';

const PI_4 = Math.PI / 4;

/** Weight (kg) of a solid cylinder given mm dimensions and density in kg/m³. */
function cylinderKg(diaMm: number, lengthMm: number, densityKgM3: number): number {
  return (PI_4 * diaMm * diaMm * lengthMm * densityKgM3) / 1e9;
}

export interface DerivedWeights {
  estNetWeightKg: number | null;
  estInputWeightKg: number | null;
  basis: string;
}

/**
 * Derive net + forged-input weight from the extracted stepped-diameter profile
 * (development.plan §6). `estInputWeightKg` is the bounding bar stock
 * (max OD × overall length); `estNetWeightKg` uses the mean captured diameter
 * as an effective diameter over the full length.
 */
export function deriveWeights(
  extract: Pick<SpecExtractResult, 'header' | 'items'>,
  densityKgM3 = 7850
): DerivedWeights {
  const diameters = extract.items
    .filter((i) => i.itemType === 'DIAMETER' && typeof i.nominalValue === 'number' && i.nominalValue! > 0)
    .map((i) => i.nominalValue as number);
  const lengths = extract.items
    .filter((i) => i.itemType === 'LENGTH' && typeof i.nominalValue === 'number' && i.nominalValue! > 0)
    .map((i) => i.nominalValue as number);

  const maxOd = extract.header.maxOdMm ?? (diameters.length ? Math.max(...diameters) : null);
  const overallLength =
    extract.header.overallLengthMm ?? (lengths.length ? Math.max(...lengths) : null);

  if (!maxOd || !overallLength) {
    return { estNetWeightKg: null, estInputWeightKg: null, basis: 'insufficient geometry on drawing' };
  }

  const estInputWeightKg = round(cylinderKg(maxOd, overallLength, densityKgM3), 4);
  const effectiveDia = diameters.length
    ? diameters.reduce((a, b) => a + b, 0) / diameters.length
    : maxOd * 0.9;
  const estNetWeightKg = round(
    Math.min(estInputWeightKg, cylinderKg(effectiveDia, overallLength, densityKgM3)),
    4
  );

  return {
    estNetWeightKg,
    estInputWeightKg,
    basis: `bounding Ø${maxOd}×${overallLength} mm, effective Ø${round(effectiveDia, 1)} mm, ρ=${densityKgM3} kg/m³`,
  };
}
