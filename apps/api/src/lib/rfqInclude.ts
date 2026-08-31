import { prisma } from './prisma.js';

/** Everything the RFQ-version detail view and the wizard need in one shot. */
export const rfqVersionFullInclude = {
  rfq: { include: { customerPart: { include: { customer: true, productType: true } } } },
  partAttributes: true,
  materials: {
    include: { materialSizeConfig: { include: { materialCategory: true, materialShape: true } } },
  },
  processes: { include: { process: true, machine: true }, orderBy: { sequence: 'asc' } },
  costSummary: true,
  attachments: true,
  reference: true,
} as const;

export const loadRfqVersionFull = (id: bigint) =>
  prisma.rfqVersion.findUnique({ where: { id }, include: rfqVersionFullInclude });
