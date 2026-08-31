import { SpecExtractResult } from '@rfq/shared';
import { prisma } from '../lib/prisma.js';
import { DerivedWeights } from './weights.js';

function parseLooseDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function avgConfidence(items: SpecExtractResult['items'], headerConf?: number | null): number | null {
  const vals = items
    .map((i) => i.confidence)
    .filter((c): c is number => typeof c === 'number');
  if (headerConf != null) vals.push(headerConf);
  if (vals.length === 0) return headerConf ?? null;
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3));
}

export interface PersistSpecParams {
  customerPartId: bigint;
  rfqVersionId: bigint;
  attachmentId: bigint | null;
  revision: string;
  extract: SpecExtractResult;
  weights: DerivedWeights;
  createdBy: bigint | null;
  mock: boolean;
}

/**
 * Upsert one `spec_analysis` per (customer_part_id, revision) and replace its
 * items — the "save by part number" rule (development.plan §5.3).
 */
export async function persistSpec(p: PersistSpecParams) {
  const h = p.extract.header;
  const headerData = {
    rfqVersionId: p.rfqVersionId,
    attachmentId: p.attachmentId,
    drawingNo: h.drawingNo ?? null,
    title: h.title ?? null,
    customerName: h.customerName ?? null,
    coNo: h.coNo ?? null,
    revision: p.revision,
    sheetSize: h.sheetSize ?? null,
    scale: h.scale ?? null,
    materialNote: h.materialNote ?? null,
    designedBy: h.designedBy ?? null,
    detailedBy: h.detailedBy ?? null,
    checkedBy: h.checkedBy ?? null,
    drawnDate: parseLooseDate(h.drawnDate),
    productType: h.productType ?? null,
    overallLengthMm: h.overallLengthMm ?? null,
    maxOdMm: h.maxOdMm ?? null,
    acrossFlatsMm: h.acrossFlatsMm ?? null,
    sectionView: h.sectionView ?? null,
    generalTolTable: h.generalTolTable != null ? JSON.stringify(h.generalTolTable) : null,
    notes: h.notes ?? null,
    estNetWeightKg: p.weights.estNetWeightKg,
    estInputWeightKg: p.weights.estInputWeightKg,
    rawExtract: JSON.stringify({ ...p.extract, _weights: p.weights, _mock: p.mock }),
    overallConfidence: avgConfidence(p.extract.items, h.confidence),
    reviewed: false,
  };

  const spec = await prisma.specAnalysis.upsert({
    where: { customerPartId_revision: { customerPartId: p.customerPartId, revision: p.revision } },
    create: { customerPartId: p.customerPartId, createdBy: p.createdBy, ...headerData },
    update: headerData,
  });

  await prisma.specAnalysisItem.deleteMany({ where: { specAnalysisId: spec.id } });
  if (p.extract.items.length) {
    await prisma.specAnalysisItem.createMany({
      data: p.extract.items.map((it) => ({
        specAnalysisId: spec.id,
        itemType: it.itemType,
        label: it.label ?? null,
        nominalValue: it.nominalValue ?? null,
        unit: it.unit ?? null,
        tolUpper: it.tolUpper ?? null,
        tolLower: it.tolLower ?? null,
        tolClass: it.tolClass ?? null,
        datum: it.datum ?? null,
        gdtType: it.gdtType ?? null,
        rawText: it.rawText ?? null,
        confidence: it.confidence ?? null,
        reviewed: false,
      })),
    });
  }

  return prisma.specAnalysis.findUnique({
    where: { id: spec.id },
    include: { items: { orderBy: { id: 'asc' } } },
  });
}
