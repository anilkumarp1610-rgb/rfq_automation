import { Router } from 'express';
import {
  productTypeSchema,
  materialTypeSchema,
  materialCategorySchema,
  materialShapeSchema,
  materialSizeConfigSchema,
  materialPriceSchema,
  handlingConfigSchema,
  processSchema,
  machineSchema,
  qcConfigSchema,
  overheadConfigSchema,
  customerMarginMapSchema,
  machineHourRate,
} from '@rfq/shared';
import { prisma } from '../lib/prisma.js';
import { crudRouter } from '../lib/crud.js';

const router = Router();

// --- Product type -----------------------------------------------------------
router.use(
  '/product-types',
  crudRouter(() => prisma.productType, {
    schema: productTypeSchema,
    orderBy: { name: 'asc' },
    searchFields: ['name'],
    softDelete: true,
    activeFilter: true,
    label: 'Product type',
  })
);

// --- Material hierarchy -----------------------------------------------------
router.use(
  '/material/types',
  crudRouter(() => prisma.materialType, {
    schema: materialTypeSchema,
    orderBy: { name: 'asc' },
    searchFields: ['name'],
    softDelete: true,
    activeFilter: true,
    label: 'Material type',
  })
);

router.use(
  '/material/categories',
  crudRouter(() => prisma.materialCategory, {
    schema: materialCategorySchema,
    orderBy: { gradeCode: 'asc' },
    include: { materialType: true },
    searchFields: ['gradeCode', 'description'],
    softDelete: true,
    activeFilter: true,
    bigIntFields: ['materialTypeId'],
    filterableFields: ['materialTypeId'],
    label: 'Material category',
  })
);

router.use(
  '/material/shapes',
  crudRouter(() => prisma.materialShape, {
    schema: materialShapeSchema,
    orderBy: { name: 'asc' },
    searchFields: ['name'],
    softDelete: true,
    activeFilter: true,
    label: 'Material shape',
  })
);

router.use(
  '/material/size-configs',
  crudRouter(() => prisma.materialSizeConfig, {
    schema: materialSizeConfigSchema,
    orderBy: { id: 'desc' },
    include: {
      materialCategory: { include: { materialType: true } },
      materialShape: true,
    },
    softDelete: true,
    activeFilter: true,
    bigIntFields: ['materialCategoryId', 'materialShapeId'],
    filterableFields: ['materialCategoryId', 'materialShapeId'],
    label: 'Material size config',
  })
);

router.use(
  '/material/prices',
  crudRouter(() => prisma.materialPrice, {
    schema: materialPriceSchema,
    orderBy: { effectiveFrom: 'desc' },
    include: {
      materialSizeConfig: {
        include: { materialCategory: { include: { materialType: true } }, materialShape: true },
      },
    },
    searchFields: ['supplier'],
    softDelete: true,
    activeFilter: true,
    bigIntFields: ['materialSizeConfigId'],
    filterableFields: ['materialSizeConfigId'],
    closePriorOn: ['materialSizeConfigId'],
    label: 'Material price',
  })
);

// --- Handling config -------------------------------------------------------
router.use(
  '/handling-config',
  crudRouter(() => prisma.handlingConfig, {
    schema: handlingConfigSchema,
    orderBy: { effectiveFrom: 'desc' },
    include: { materialType: true },
    softDelete: true,
    activeFilter: true,
    bigIntFields: ['materialTypeId'],
    filterableFields: ['materialTypeId'],
    closePriorOn: ['materialTypeId'],
    label: 'Handling config',
  })
);

// --- Process & machine ----------------------------------------------------
router.use(
  '/processes',
  crudRouter(() => prisma.process, {
    schema: processSchema,
    orderBy: { name: 'asc' },
    searchFields: ['name', 'description'],
    softDelete: true,
    activeFilter: true,
    label: 'Process',
  })
);

router.use(
  '/machines',
  crudRouter(() => prisma.machine, {
    schema: machineSchema,
    orderBy: { name: 'asc' },
    searchFields: ['name', 'type'],
    softDelete: true,
    activeFilter: true,
    label: 'Machine',
    // hourly_rate is a derived roll-up of the build-up components
    transform: (b) => ({
      ...b,
      hourlyRate: machineHourRate({
        depreciationHr: Number(b.depreciationHr ?? 0),
        powerHr: Number(b.powerHr ?? 0),
        maintenanceHr: Number(b.maintenanceHr ?? 0),
        operatorHr: Number(b.operatorHr ?? 0),
        toolingHr: Number(b.toolingHr ?? 0),
        overheadHr: Number(b.overheadHr ?? 0),
      }),
    }),
  })
);

// --- QC / overhead / margin map -----------------------------------------
router.use(
  '/qc-config',
  crudRouter(() => prisma.qcConfig, {
    schema: qcConfigSchema,
    orderBy: { effectiveFrom: 'desc' },
    softDelete: true,
    activeFilter: true,
    closePriorOn: true,
    label: 'QC config',
  })
);

router.use(
  '/overhead-config',
  crudRouter(() => prisma.overheadConfig, {
    schema: overheadConfigSchema,
    orderBy: { effectiveFrom: 'desc' },
    softDelete: true,
    activeFilter: true,
    closePriorOn: true,
    label: 'Overhead config',
  })
);

router.use(
  '/customer-margin-map',
  crudRouter(() => prisma.customerMarginMap, {
    schema: customerMarginMapSchema,
    orderBy: [{ rating: 'asc' }, { effectiveFrom: 'desc' }],
    softDelete: true,
    activeFilter: true,
    closePriorOn: ['rating'],
    label: 'Customer margin map',
  })
);

export default router;
