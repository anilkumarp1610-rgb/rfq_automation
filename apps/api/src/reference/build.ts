import { prisma } from '../lib/prisma.js';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface KeyDims {
  maxOdMm: number | null;
  overallLengthMm: number | null;
  acrossFlatsMm: number | null;
  netWeightKg: number | null;
}

export interface BuildResult {
  reference?: unknown;
  skipped?: string;
}

/**
 * (Re)build the `rfq_reference` row for a version — the growing history used to
 * reference future RFQs (development.plan §5.2). Needs a computed cost summary.
 */
export async function buildReference(
  versionId: bigint,
  opts: { outcome?: string; actualCost?: number | null } = {}
): Promise<BuildResult> {
  const version = await prisma.rfqVersion.findUnique({
    where: { id: versionId },
    include: {
      partAttributes: true,
      costSummary: true,
      reference: true,
      rfq: { include: { customerPart: true } },
    },
  });
  if (!version) return { skipped: 'version not found' };
  if (!version.costSummary) return { skipped: 'no cost summary — run the cost engine first' };

  const attrs = version.partAttributes;
  const part = version.rfq.customerPart;
  const revision = version.basedOnPartRevision?.trim() || part.currentRevision?.trim() || 'R00';
  const spec = await prisma.specAnalysis.findUnique({
    where: { customerPartId_revision: { customerPartId: part.id, revision } },
  });

  const keyDims: KeyDims = {
    maxOdMm: num(spec?.maxOdMm),
    overallLengthMm: num(spec?.overallLengthMm),
    acrossFlatsMm: num(spec?.acrossFlatsMm),
    netWeightKg: num(attrs?.netWeightKg) ?? num(spec?.estNetWeightKg),
  };

  const data = {
    productTypeId: attrs?.productTypeId ?? part.productTypeId ?? null,
    materialCategoryId: attrs?.materialCategoryId ?? null,
    keyDims: JSON.stringify(keyDims),
    quotedPricePerPc: Number(version.costSummary.quotedPricePerPc),
    outcome: opts.outcome ?? version.reference?.outcome ?? 'QUOTED',
    actualCost:
      opts.actualCost !== undefined ? opts.actualCost : (version.reference?.actualCost ?? null),
  };

  const reference = await prisma.rfqReference.upsert({
    where: { rfqVersionId: versionId },
    create: { rfqVersionId: versionId, ...data },
    update: data,
  });
  return { reference };
}

/** Statuses that make a version worth recording as reference history. */
export const REFERENCEABLE = new Set(['QUOTED', 'WON', 'LOST']);
