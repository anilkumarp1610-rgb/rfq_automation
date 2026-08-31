import { SpecExtractResult } from '@rfq/shared';

/**
 * Deterministic stand-in used when no ANTHROPIC_API_KEY is configured, so the
 * upload → analyze → review → apply flow stays testable in local dev.
 * Mirrors the two worked drawings from development.plan §6 (P01273549 / P01273550).
 */
export function mockExtraction(hint?: { partNumber?: string; revision?: string }): SpecExtractResult {
  const pn = (hint?.partNumber ?? '').toUpperCase();
  const big = pn.includes('550') || pn.includes('84');

  const od = big ? 26 : 22;
  const length = big ? 84 : 45;

  const header = {
    drawingNo: pn || (big ? 'P01273550' : 'P01273549'),
    title: `SHAFT ${od} X ${length} LONG`,
    customerName: 'SEPL STD',
    coNo: null,
    revision: hint?.revision ?? 'R00',
    sheetSize: 'A3',
    scale: '1:1',
    materialNote: 'AS PER BOM',
    designedBy: null,
    detailedBy: null,
    checkedBy: null,
    drawnDate: null,
    productType: 'Shaft',
    overallLengthMm: length,
    maxOdMm: od,
    acrossFlatsMm: null,
    sectionView: null,
    generalTolTable: { linear: '±0.1', angular: '±0.5°' },
    notes: 'BREAK ALL SHARP EDGES | REMOVE BURRS',
    confidence: 0.55,
  };

  const items: SpecExtractResult['items'] = [
    {
      itemType: 'DIAMETER',
      label: `Ø${od}`,
      nominalValue: od,
      unit: 'mm',
      tolUpper: null,
      tolLower: null,
      tolClass: null,
      datum: null,
      gdtType: null,
      rawText: `Ø${od}`,
      confidence: 0.6,
    },
    {
      itemType: 'DIAMETER',
      label: 'Ø17 m6',
      nominalValue: 17,
      unit: 'mm',
      tolUpper: 0.02,
      tolLower: 0.01,
      tolClass: 'm6',
      datum: null,
      gdtType: null,
      rawText: 'Ø17 m6 (+0.02/+0.01)',
      confidence: 0.6,
    },
    {
      itemType: 'LENGTH',
      label: `${length} LONG`,
      nominalValue: length,
      unit: 'mm',
      tolUpper: null,
      tolLower: null,
      tolClass: null,
      datum: null,
      gdtType: null,
      rawText: `${length}`,
      confidence: 0.6,
    },
    {
      itemType: 'THREAD',
      label: 'M16x1.5',
      nominalValue: 16,
      unit: 'mm',
      tolUpper: null,
      tolLower: null,
      tolClass: '6g',
      datum: null,
      gdtType: null,
      rawText: 'M16 x 1.5',
      confidence: 0.55,
    },
    {
      itemType: 'CHAMFER',
      label: '2x45°',
      nominalValue: 2,
      unit: 'mm',
      tolUpper: null,
      tolLower: null,
      tolClass: null,
      datum: null,
      gdtType: null,
      rawText: '2 x 45°',
      confidence: 0.55,
    },
    {
      itemType: 'UNDERCUT',
      label: 'Ø14 x 2 wide',
      nominalValue: 14,
      unit: 'mm',
      tolUpper: null,
      tolLower: null,
      tolClass: null,
      datum: null,
      gdtType: null,
      rawText: 'UNDERCUT Ø14 x 2',
      confidence: 0.5,
    },
    {
      itemType: 'GDT',
      label: 'Perpendicularity 0.02 to A',
      nominalValue: 0.02,
      unit: 'mm',
      tolUpper: null,
      tolLower: null,
      tolClass: null,
      datum: 'A',
      gdtType: 'perpendicularity',
      rawText: '⊥ 0.02 A',
      confidence: 0.5,
    },
  ];

  if (big) {
    items.push({
      itemType: 'HOLE',
      label: 'Ø3.7 split-pin hole',
      nominalValue: 3.7,
      unit: 'mm',
      tolUpper: null,
      tolLower: null,
      tolClass: null,
      datum: null,
      gdtType: null,
      rawText: 'Ø3.7 THRU (split pin)',
      confidence: 0.5,
    });
  } else {
    items.push({
      itemType: 'HOLE',
      label: 'Ø4 THRU',
      nominalValue: 4,
      unit: 'mm',
      tolUpper: null,
      tolLower: null,
      tolClass: null,
      datum: null,
      gdtType: null,
      rawText: 'Ø4 THRU',
      confidence: 0.5,
    });
  }

  return {
    header,
    items,
    flags: [
      'Material not specified on drawing (shown as "AS PER BOM") — estimator must pick a real grade.',
      'MOCK EXTRACTION — no ANTHROPIC_API_KEY configured; values are illustrative, review carefully.',
    ],
  };
}
