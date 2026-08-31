import { prisma } from '../lib/prisma.js';
import { EngineInput, EngineProcessLine, ProcessType, CostingMethod } from './types.js';

export interface ResolveOptions {
  asOfDate?: Date;
  quantity?: number;
  marginAdjustmentPct?: number;
  marginOverridePct?: number | null;
}

export interface ResolvedInput {
  input: EngineInput;
  warnings: string[];
  /** the loaded version with the relations the compute route needs to write back */
  version: NonNullable<Awaited<ReturnType<typeof loadVersion>>>;
}

const num = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function loadVersion(id: bigint) {
  return prisma.rfqVersion.findUnique({
    where: { id },
    include: {
      partAttributes: true,
      materials: true,
      processes: { include: { process: true, machine: true }, orderBy: { sequence: 'asc' } },
      rfq: { include: { customerPart: { include: { customer: true } } } },
    },
  });
}

/** effective-dated `findFirst`, newest first. */
function effectiveWhere(asOfDate: Date) {
  return {
    isActive: true,
    effectiveFrom: { lte: asOfDate },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
  };
}

async function resolveMaterial(
  version: NonNullable<Awaited<ReturnType<typeof loadVersion>>>,
  asOfDate: Date,
  warnings: string[]
): Promise<EngineInput['material']> {
  const attrs = version.partAttributes;
  const netWeightKg = num(attrs?.netWeightKg);
  const forgingLossPct = num(attrs?.forgiveLossPct);

  const matLine = version.materials[0];
  let ratePerKg = matLine ? num(matLine.ratePerKg) : 0;
  const wastagePct = matLine ? num(matLine.wastagePct) : 0;
  const inputWeightKgOverride = matLine ? num(matLine.inputWeightKg) : 0;

  if (netWeightKg <= 0 && inputWeightKgOverride <= 0) {
    warnings.push('Net weight is not set — material cost is treated as 0.');
    return null;
  }

  let sizeConfigId: bigint | null = matLine?.materialSizeConfigId ?? null;
  if (!sizeConfigId && attrs?.materialCategoryId) {
    const sc = await prisma.materialSizeConfig.findFirst({
      where: {
        isActive: true,
        materialCategoryId: attrs.materialCategoryId,
        ...(attrs.materialShapeId ? { materialShapeId: attrs.materialShapeId } : {}),
      },
    });
    sizeConfigId = sc?.id ?? null;
  }

  if (ratePerKg <= 0 && sizeConfigId) {
    const price = await prisma.materialPrice.findFirst({
      where: { ...effectiveWhere(asOfDate), materialSizeConfigId: sizeConfigId },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (price) ratePerKg = num(price.ratePerKg);
  }

  if (ratePerKg <= 0) {
    warnings.push(
      'No effective material price found for the selected grade/shape — material cost is 0.'
    );
    return null;
  }

  return {
    netWeightKg,
    forgingLossPct,
    ratePerKg,
    wastagePct,
    ...(inputWeightKgOverride > 0 ? { inputWeightKgOverride } : {}),
  };
}

async function resolveHandling(
  materialTypeId: bigint | null,
  asOfDate: Date,
  warnings: string[]
): Promise<EngineInput['handling']> {
  const base = effectiveWhere(asOfDate);
  let hc = materialTypeId
    ? await prisma.handlingConfig.findFirst({
        where: { ...base, materialTypeId },
        orderBy: { effectiveFrom: 'desc' },
      })
    : null;
  if (!hc) {
    hc = await prisma.handlingConfig.findFirst({
      where: { ...base, materialTypeId: null },
      orderBy: { effectiveFrom: 'desc' },
    });
  }
  if (!hc) {
    warnings.push('No handling config in effect — handling cost is 0.');
    return null;
  }
  return {
    procurementPct: num(hc.procurementPct),
    transportationRate: num(hc.transportationRate),
    transportationUom: hc.transportationUom === 'per_kg' ? 'per_kg' : 'per_lot',
    storagePct: num(hc.storagePct),
  };
}

async function resolveQc(asOfDate: Date, warnings: string[]): Promise<EngineInput['qc']> {
  const qc = await prisma.qcConfig.findFirst({
    where: effectiveWhere(asOfDate),
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!qc) {
    warnings.push('No QC config in effect — QC cost is 0.');
    return { method: 'PCT_OF_MFG', qcPct: 0 };
  }
  let inspectionStandards: Record<string, number> | null = null;
  if (qc.inspectionStandards) {
    try {
      inspectionStandards = JSON.parse(qc.inspectionStandards);
    } catch {
      warnings.push('QC config inspection_standards is not valid JSON — ignored.');
    }
  }
  const method = (['PCT_OF_MFG', 'PER_INSPECTION', 'RULE'] as const).includes(qc.method as never)
    ? (qc.method as EngineInput['qc']['method'])
    : 'PCT_OF_MFG';
  return { method, qcPct: num(qc.qcPct), inspectionStandards };
}

function toEngineProcessLines(
  rows: NonNullable<Awaited<ReturnType<typeof loadVersion>>>['processes'],
  warnings: string[]
): EngineProcessLine[] {
  return rows.map((rp) => {
    const method = (rp.method || rp.process.costingMethod) as CostingMethod;
    let rate = num(rp.rate);
    if (rate <= 0) {
      if (method === 'CYCLE_TIME' && rp.machine) rate = num(rp.machine.hourlyRate);
      else if (rp.process.defaultRate != null) rate = num(rp.process.defaultRate);
      if (rate <= 0) warnings.push(`Process "${rp.process.name}" has no rate — its cost is 0.`);
    }
    return {
      ref: rp.id.toString(),
      sequence: rp.sequence,
      name: rp.process.name,
      processType: rp.process.processType as ProcessType,
      method,
      quantityOrTime: num(rp.quantityOrTime),
      rate,
    };
  });
}

/** Load a version and assemble a fully-resolved, master-driven `EngineInput`. */
export async function resolveEngineInput(
  versionId: bigint,
  opts: ResolveOptions = {}
): Promise<ResolvedInput | null> {
  const version = await loadVersion(versionId);
  if (!version) return null;

  const warnings: string[] = [];
  const asOfDate = opts.asOfDate ?? new Date();
  const attrs = version.partAttributes;
  const customer = version.rfq.customerPart.customer;

  const batchQty = num(version.rfq.batchQty);
  const quantity =
    opts.quantity ?? (num(version.rfq.annualQty) || num(version.rfq.batchQty) || 1);

  const material = await resolveMaterial(version, asOfDate, warnings);

  let materialTypeId: bigint | null = null;
  if (attrs?.materialCategoryId) {
    const cat = await prisma.materialCategory.findUnique({
      where: { id: attrs.materialCategoryId },
    });
    materialTypeId = cat?.materialTypeId ?? null;
  }
  const handling = await resolveHandling(materialTypeId, asOfDate, warnings);

  const qc = await resolveQc(asOfDate, warnings);

  const overhead = await prisma.overheadConfig.findFirst({
    where: effectiveWhere(asOfDate),
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!overhead) warnings.push('No overhead config in effect — admin cost is 0.');

  const rating = customer?.rating ?? 3;
  const marginRow = await prisma.customerMarginMap.findFirst({
    where: { ...effectiveWhere(asOfDate), rating },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!marginRow) {
    warnings.push(`No margin mapping for customer rating ${rating} — base margin is 0.`);
  }

  const processes = toEngineProcessLines(version.processes, warnings);
  if (processes.length === 0) warnings.push('No process lines added yet.');

  const input: EngineInput = {
    asOfDate,
    quantity,
    batchQty,
    customerRating: rating,
    material,
    handling,
    processes,
    qc,
    adminPct: num(overhead?.adminPct),
    baseMarginPct: num(marginRow?.baseMarginPct),
    marginAdjustmentPct: opts.marginAdjustmentPct ?? 0,
    marginOverridePct: opts.marginOverridePct ?? null,
  };

  return { input, warnings, version };
}
