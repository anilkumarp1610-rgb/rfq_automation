import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/http.js';

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export interface CostSheetLine {
  label: string;
  detail?: string;
  amount: number;
  emphasis?: boolean;
}

export interface CostSheetVM {
  quoteNo: string;
  rfqNumber: string;
  revisionNo: number;
  status: string;
  date: string; // yyyy-mm-dd
  validUntil: string;
  currency: string;
  customer: { code: string | null; name: string | null; paymentTerms: string | null; rating: number | null };
  part: { number: string; name: string; drawingNo: string | null; revision: string | null; productType: string | null };
  quantity: number;
  batchQty: number;
  sourcing: 'MANUFACTURED' | 'BOUGHT_OUT';
  supplier: string | null;
  purchasePricePerPc: number | null;
  material: { grade: string | null; shape: string | null; inputWeightKg: number | null; ratePerKg: number | null };
  processes: { sequence: number; name: string; type: string; method: string; qtyOrTime: number; rate: number; cost: number }[];
  buildUp: CostSheetLine[];
  quotedPricePerPc: number;
  totalQuote: number;
  marginPct: number;
  recommendedMarginPct: number | null;
  computedAt: string | null;
}

/** Assemble the printable cost-sheet / quotation view model for a version. */
export async function costSheetViewModel(versionId: bigint): Promise<CostSheetVM> {
  const v = await prisma.rfqVersion.findUnique({
    where: { id: versionId },
    include: {
      costSummary: true,
      partAttributes: true,
      materials: { include: { materialSizeConfig: { include: { materialCategory: true, materialShape: true } } } },
      processes: { include: { process: true }, orderBy: { sequence: 'asc' } },
      rfq: { include: { customerPart: { include: { customer: true, productType: true } } } },
    },
  });
  if (!v) notFound('RFQ version');
  const s = v!.costSummary;
  if (!s) {
    const err = new Error('Cost has not been computed for this revision yet') as Error & { status?: number };
    err.status = 409;
    throw err;
  }

  const rfq = v!.rfq;
  const part = rfq.customerPart;
  const cust = part.customer;
  const now = new Date();
  const plus30 = new Date(now.getTime() + 30 * 864e5);
  const matLine = v!.materials[0];

  let matCat: { gradeCode: string } | null = matLine?.materialSizeConfig.materialCategory ?? null;
  let matShape: { name: string } | null = matLine?.materialSizeConfig.materialShape ?? null;
  if (!matCat && v!.partAttributes?.materialCategoryId) {
    matCat = await prisma.materialCategory.findUnique({ where: { id: v!.partAttributes.materialCategoryId } });
  }
  if (!matShape && v!.partAttributes?.materialShapeId) {
    matShape = await prisma.materialShape.findUnique({ where: { id: v!.partAttributes.materialShapeId } });
  }

  const boughtOut = v!.partAttributes?.sourcingType === 'BOUGHT_OUT';

  const buildUp: CostSheetLine[] = [
    { label: boughtOut ? 'Purchase cost' : 'Material base cost', amount: n(s.materialCost) },
    { label: 'Handling (procurement + transport + storage + packing)', amount: n(s.handlingCost) },
    ...(boughtOut
      ? []
      : [
          { label: 'Machining cost', amount: n(s.machiningCost) },
          { label: 'Manual process cost', amount: n(s.manualCost) },
          { label: 'Subcontracting cost', amount: n(s.subcontractCost) },
        ]),
    ...(boughtOut && n(s.machiningCost) + n(s.manualCost) + n(s.subcontractCost) > 0
      ? [{ label: 'Assembly / inspection', amount: n(s.machiningCost) + n(s.manualCost) + n(s.subcontractCost) }]
      : []),
    { label: 'QC cost (auto-derived)', amount: n(s.qcCost) },
    { label: boughtOut ? 'Landed cost' : 'Manufacturing cost', amount: n(s.mfgCost), emphasis: true },
    { label: 'Administration cost', amount: n(s.adminCost) },
    { label: 'Subtotal', amount: n(s.subtotal), emphasis: true },
    {
      label: 'Profit margin',
      detail: `${n(s.marginPct)}%${
        s.aiRecommendedMarginPct != null && n(s.aiRecommendedMarginPct) !== n(s.marginPct)
          ? ` (recommended ${n(s.aiRecommendedMarginPct)}%)`
          : ''
      }`,
      amount: n(s.marginAmount),
    },
    { label: 'Quoted price / piece', amount: n(s.quotedPricePerPc), emphasis: true },
  ];

  return {
    quoteNo: `${rfq.rfqNumber}-R${v!.revisionNo}`,
    rfqNumber: rfq.rfqNumber,
    revisionNo: v!.revisionNo,
    status: v!.status,
    date: now.toISOString().slice(0, 10),
    validUntil: plus30.toISOString().slice(0, 10),
    currency: rfq.currency,
    customer: {
      code: cust?.code ?? null,
      name: cust?.name ?? null,
      paymentTerms: cust?.paymentTerms ?? null,
      rating: cust?.rating ?? null,
    },
    part: {
      number: part.customerPartNumber,
      name: part.partName,
      drawingNo: part.drawingNo ?? null,
      revision: v!.basedOnPartRevision ?? part.currentRevision ?? null,
      productType: part.productType?.name ?? null,
    },
    quantity: n(rfq.annualQty) || n(rfq.batchQty) || 1,
    sourcing: boughtOut ? 'BOUGHT_OUT' : 'MANUFACTURED',
    supplier: v!.partAttributes?.supplierName ?? null,
    purchasePricePerPc: v!.partAttributes?.purchasePricePerPc != null ? n(v!.partAttributes.purchasePricePerPc) : null,
    batchQty: n(rfq.batchQty),
    material: {
      grade: matCat?.gradeCode ?? null,
      shape: matShape?.name ?? null,
      inputWeightKg: matLine ? n(matLine.inputWeightKg) : null,
      ratePerKg: matLine ? n(matLine.ratePerKg) : null,
    },
    processes: v!.processes.map((p) => ({
      sequence: p.sequence,
      name: p.process.name,
      type: p.process.processType,
      method: p.method,
      qtyOrTime: n(p.quantityOrTime),
      rate: n(p.rate),
      cost: n(p.cost),
    })),
    buildUp,
    quotedPricePerPc: n(s.quotedPricePerPc),
    totalQuote: n(s.totalQuote),
    marginPct: n(s.marginPct),
    recommendedMarginPct: s.aiRecommendedMarginPct != null ? n(s.aiRecommendedMarginPct) : null,
    computedAt: s.computedAt ? new Date(s.computedAt).toISOString() : null,
  };
}
