import { prisma } from '../lib/prisma.js';
import { KeyDims } from './build.js';

export interface SimilarTarget {
  partId: bigint | null;
  productTypeId: bigint | null;
  materialCategoryId: bigint | null;
  dims: KeyDims;
}

/** 1 when equal, decaying to 0 as the values diverge; 0 if either is missing. */
function proximity(a: number | null, b: number | null): number {
  if (a == null || b == null || a <= 0 || b <= 0) return 0;
  return Math.max(0, 1 - Math.abs(a - b) / Math.max(a, b));
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface SimilarRow {
  referenceId: string;
  rfqVersionId: string;
  score: number;
  samePart: boolean;
  rfqNumber: string;
  revisionNo: number;
  customerPartNumber: string;
  partName: string;
  customerCode: string | null;
  productType: string | null;
  materialGrade: string | null;
  keyDims: KeyDims | null;
  quotedPricePerPc: number;
  outcome: string;
  actualCost: number | null;
}

/** Rank existing `rfq_reference` rows by similarity to a target part/estimate. */
export async function findSimilar(target: SimilarTarget, limit: number): Promise<SimilarRow[]> {
  const refs = await prisma.rfqReference.findMany({
    include: {
      rfqVersion: {
        include: { rfq: { include: { customerPart: { include: { customer: true } } } } },
      },
    },
  });

  const productTypeIds = [
    ...new Set(refs.map((r) => r.productTypeId).filter((v): v is bigint => v != null)),
  ];
  const materialIds = [
    ...new Set(refs.map((r) => r.materialCategoryId).filter((v): v is bigint => v != null)),
  ];
  const [productTypes, materials] = await Promise.all([
    prisma.productType.findMany({ where: { id: { in: productTypeIds } } }),
    prisma.materialCategory.findMany({ where: { id: { in: materialIds } } }),
  ]);
  const ptName = new Map(productTypes.map((p) => [p.id.toString(), p.name]));
  const matName = new Map(materials.map((m) => [m.id.toString(), m.gradeCode]));

  const scored: SimilarRow[] = refs
    .filter((r) => r.rfqVersion.rfq.customerPartId !== target.partId) // exclude the part itself
    .map((r) => {
      let dims: KeyDims | null = null;
      try {
        dims = r.keyDims ? (JSON.parse(r.keyDims) as KeyDims) : null;
      } catch {
        dims = null;
      }

      let score = 0;
      if (
        target.productTypeId &&
        r.productTypeId &&
        r.productTypeId.toString() === target.productTypeId.toString()
      )
        score += 3;
      if (
        target.materialCategoryId &&
        r.materialCategoryId &&
        r.materialCategoryId.toString() === target.materialCategoryId.toString()
      )
        score += 3;
      score += proximity(target.dims.netWeightKg, dims?.netWeightKg ?? null) * 2.5;
      score += proximity(target.dims.maxOdMm, dims?.maxOdMm ?? null) * 1.5;
      score += proximity(target.dims.overallLengthMm, dims?.overallLengthMm ?? null) * 1.5;
      score += proximity(target.dims.acrossFlatsMm, dims?.acrossFlatsMm ?? null) * 0.5;
      if (r.outcome === 'WON') score += 0.25; // prefer proven quotes on ties

      const part = r.rfqVersion.rfq.customerPart;
      return {
        referenceId: r.id.toString(),
        rfqVersionId: r.rfqVersionId.toString(),
        score: Number(score.toFixed(3)),
        samePart: false,
        rfqNumber: r.rfqVersion.rfq.rfqNumber,
        revisionNo: r.rfqVersion.revisionNo,
        customerPartNumber: part.customerPartNumber,
        partName: part.partName,
        customerCode: part.customer?.code ?? null,
        productType: r.productTypeId ? (ptName.get(r.productTypeId.toString()) ?? null) : null,
        materialGrade: r.materialCategoryId
          ? (matName.get(r.materialCategoryId.toString()) ?? null)
          : null,
        keyDims: dims,
        quotedPricePerPc: num(r.quotedPricePerPc) ?? 0,
        outcome: r.outcome,
        actualCost: num(r.actualCost),
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

/** Resolve a similarity target from an RFQ version. */
export async function targetFromVersion(versionId: bigint): Promise<SimilarTarget | null> {
  const version = await prisma.rfqVersion.findUnique({
    where: { id: versionId },
    include: { partAttributes: true, rfq: { include: { customerPart: true } } },
  });
  if (!version) return null;
  const attrs = version.partAttributes;
  const part = version.rfq.customerPart;
  const revision = version.basedOnPartRevision?.trim() || part.currentRevision?.trim() || 'R00';
  const spec = await prisma.specAnalysis.findUnique({
    where: { customerPartId_revision: { customerPartId: part.id, revision } },
  });
  return {
    partId: part.id,
    productTypeId: attrs?.productTypeId ?? part.productTypeId ?? null,
    materialCategoryId: attrs?.materialCategoryId ?? null,
    dims: {
      maxOdMm: num(spec?.maxOdMm),
      overallLengthMm: num(spec?.overallLengthMm),
      acrossFlatsMm: num(spec?.acrossFlatsMm),
      netWeightKg: num(attrs?.netWeightKg) ?? num(spec?.estNetWeightKg),
    },
  };
}

/** Resolve a similarity target from a customer part (latest spec + latest version). */
export async function targetFromPart(partId: bigint): Promise<SimilarTarget | null> {
  const part = await prisma.customerPart.findUnique({ where: { id: partId } });
  if (!part) return null;
  const latestVersion = await prisma.rfqVersion.findFirst({
    where: { rfq: { customerPartId: partId } },
    orderBy: { createdAt: 'desc' },
    include: { partAttributes: true },
  });
  const spec = await prisma.specAnalysis.findFirst({
    where: { customerPartId: partId },
    orderBy: { createdAt: 'desc' },
  });
  const attrs = latestVersion?.partAttributes;
  return {
    partId,
    productTypeId: attrs?.productTypeId ?? part.productTypeId ?? null,
    materialCategoryId: attrs?.materialCategoryId ?? null,
    dims: {
      maxOdMm: num(spec?.maxOdMm),
      overallLengthMm: num(spec?.overallLengthMm),
      acrossFlatsMm: num(spec?.acrossFlatsMm),
      netWeightKg: num(attrs?.netWeightKg) ?? num(spec?.estNetWeightKg),
    },
  };
}
