import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const today = new Date();

async function seedPlatform() {
  const roles = [
    { code: 'ADMIN', name: 'Administrator' },
    { code: 'ESTIMATOR', name: 'Estimator' },
    { code: 'MANAGER', name: 'Manager' },
    { code: 'VIEWER', name: 'Viewer' },
  ];
  for (const r of roles) {
    await prisma.role.upsert({ where: { code: r.code }, update: {}, create: r });
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  const admin = await prisma.user.upsert({
    where: { email: 'admin@rfq.local' },
    update: {},
    create: {
      email: 'admin@rfq.local',
      name: 'System Admin',
      passwordHash: await bcrypt.hash('Admin@123', 10),
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });
  console.log('✓ Roles + admin user (admin@rfq.local / Admin@123)');
}

async function seedMasters() {
  if ((await prisma.materialType.count()) > 0) {
    console.log('• Masters already seeded — skipping');
    return;
  }

  // Customers -------------------------------------------------------------
  await prisma.customer.createMany({
    data: [
      { code: 'SEPL', name: 'SEPL STD', rating: 4, paymentTerms: 'Net 30', deliveryLocation: 'Pune' },
      { code: 'TATA', name: 'Tata Motors Ltd', rating: 5, paymentTerms: 'Net 45', deliveryLocation: 'Pune' },
      { code: 'BOSCH', name: 'Bosch Ltd', rating: 3, paymentTerms: 'Net 60', deliveryLocation: 'Bangalore' },
    ],
  });

  // Product types -------------------------------------------------------
  await prisma.productType.createMany({
    data: [
      { name: 'Shaft', description: 'Rotating shaft components' },
      { name: 'Flange', description: 'Forged flanges' },
      { name: 'Gear Blank', description: 'Forged gear blanks' },
      { name: 'Pin', description: 'Pins and dowels' },
    ],
  });

  // Material hierarchy -------------------------------------------------
  const carbon = await prisma.materialType.create({ data: { name: 'Carbon Steel' } });
  const alloy = await prisma.materialType.create({ data: { name: 'Alloy Steel' } });
  const stainless = await prisma.materialType.create({ data: { name: 'Stainless Steel' } });

  const grades = await prisma.$transaction([
    prisma.materialCategory.create({
      data: { materialTypeId: carbon.id, gradeCode: 'EN8', description: 'Medium carbon steel', densityKgM3: 7850 },
    }),
    prisma.materialCategory.create({
      data: { materialTypeId: alloy.id, gradeCode: 'EN19', description: 'Cr-Mo alloy steel', densityKgM3: 7850 },
    }),
    prisma.materialCategory.create({
      data: { materialTypeId: alloy.id, gradeCode: 'SAE4140', description: 'Chromoly steel', densityKgM3: 7850 },
    }),
    prisma.materialCategory.create({
      data: { materialTypeId: stainless.id, gradeCode: 'SS304', description: 'Austenitic stainless', densityKgM3: 8000 },
    }),
  ]);

  const shapes = await prisma.$transaction(
    ['Round Bar', 'Billet', 'Flat', 'Hex'].map((name) => prisma.materialShape.create({ data: { name } }))
  );

  const roundBar = shapes[0];
  const sizeConfigs = await prisma.$transaction([
    prisma.materialSizeConfig.create({
      data: { materialCategoryId: grades[0].id, materialShapeId: roundBar.id, odMm: 25, lengthMm: 3000, uom: 'kg' },
    }),
    prisma.materialSizeConfig.create({
      data: { materialCategoryId: grades[1].id, materialShapeId: roundBar.id, odMm: 30, lengthMm: 3000, uom: 'kg' },
    }),
    prisma.materialSizeConfig.create({
      data: { materialCategoryId: grades[2].id, materialShapeId: roundBar.id, odMm: 40, lengthMm: 3000, uom: 'kg' },
    }),
  ]);

  await prisma.materialPrice.createMany({
    data: [
      { materialSizeConfigId: sizeConfigs[0].id, ratePerKg: 78.5, supplier: 'Steel Direct', effectiveFrom: today },
      { materialSizeConfigId: sizeConfigs[1].id, ratePerKg: 92.0, supplier: 'Alloy Corp', effectiveFrom: today },
      { materialSizeConfigId: sizeConfigs[2].id, ratePerKg: 105.0, supplier: 'Alloy Corp', effectiveFrom: today },
    ],
  });

  await prisma.handlingConfig.create({
    data: {
      materialTypeId: null,
      procurementPct: 2,
      storagePct: 1.5,
      transportationMode: 'PER_KG',
      transportationRate: 3.5,
      packingMode: 'FIXED',
      packingCost: 0,
      effectiveFrom: today,
    },
  });

  // Processes -----------------------------------------------------------
  await prisma.process.createMany({
    data: [
      { name: 'Open-die Forging', processType: 'MACHINE', costingMethod: 'PER_KG', defaultRate: 22, uom: 'kg' },
      { name: 'CNC Turning', processType: 'MACHINE', costingMethod: 'CYCLE_TIME', uom: 'hour' },
      { name: 'Cylindrical Grinding', processType: 'MACHINE', costingMethod: 'CYCLE_TIME', uom: 'hour' },
      { name: 'Drilling', processType: 'MACHINE', costingMethod: 'CYCLE_TIME', uom: 'hour' },
      { name: 'Manual Deburring', processType: 'MANUAL', costingMethod: 'FLAT_PC', defaultRate: 8, uom: 'pc' },
      { name: 'Fettling', processType: 'MANUAL', costingMethod: 'FLAT_PC', defaultRate: 6, uom: 'pc' },
      { name: 'Visual + Packing', processType: 'MANUAL', costingMethod: 'FLAT_PC', defaultRate: 4, uom: 'pc' },
      { name: 'Heat Treatment', processType: 'SUBCONTRACT', costingMethod: 'PER_KG', defaultRate: 18, uom: 'kg' },
      { name: 'Zinc Plating', processType: 'SUBCONTRACT', costingMethod: 'PER_LOT', defaultRate: 4500, uom: 'lot' },
    ],
  });

  // Machines (hourlyRate = sum of build-up) ---------------------------
  const machine = (
    name: string,
    type: string,
    dep: number,
    pow: number,
    mnt: number,
    op: number,
    tool: number,
    oh: number
  ) => ({
    name,
    type,
    depreciationHr: dep,
    powerHr: pow,
    maintenanceHr: mnt,
    operatorHr: op,
    toolingHr: tool,
    overheadHr: oh,
    hourlyRate: dep + pow + mnt + op + tool + oh,
  });

  await prisma.machine.createMany({
    data: [
      machine('CNC-001', 'CNC Turning', 50, 30, 40, 150, 80, 100),
      machine('VMC-001', 'VMC', 60, 35, 45, 160, 90, 110),
      machine('GRIND-001', 'Cylindrical Grinder', 40, 25, 35, 140, 70, 90),
      machine('HAMMER-1T', '1T Hammer', 80, 60, 70, 200, 40, 150),
    ],
  });

  await prisma.qcConfig.create({ data: { method: 'PCT_OF_MFG', qcPct: 5, effectiveFrom: today } });
  await prisma.overheadConfig.create({ data: { adminPct: 8, effectiveFrom: today } });

  await prisma.customerMarginMap.createMany({
    data: [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      baseMarginPct: 12 + rating * 2,
      effectiveFrom: today,
    })),
  });

  console.log('✓ Masters: customers, product types, material hierarchy, processes, machines, configs');
}

async function seedWorkedExamples() {
  if ((await prisma.customerPart.count()) > 0) {
    console.log('• Worked examples already seeded — skipping');
    return;
  }
  const sepl = await prisma.customer.findUniqueOrThrow({ where: { code: 'SEPL' } });
  const shaft = await prisma.productType.findFirstOrThrow({ where: { name: 'Shaft' } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@rfq.local' } });

  // Two worked drawings from development.plan §6
  const specs = [
    { pn: 'P01273549', name: 'SHAFT OD 22 X 45 LONG', od: 22, len: 45, hole: 4 },
    { pn: 'P01273550', name: 'SHAFT 26 X 84 LONG', od: 26, len: 84, hole: 3.7 },
  ];

  for (const s of specs) {
    const part = await prisma.customerPart.create({
      data: {
        customerId: sepl.id,
        customerPartNumber: s.pn,
        partName: s.name,
        productTypeId: shaft.id,
        drawingNo: s.pn,
        currentRevision: 'R00',
      },
    });

    // stepped-diameter weight estimate (bounding bar stock vs mean-Ø net)
    const cyl = (d: number, l: number) => (Math.PI / 4) * d * d * l * 7850 / 1e9;
    const meanDia = (s.od + 17) / 2;
    const estInput = +cyl(s.od, s.len).toFixed(4);
    const estNet = +Math.min(estInput, cyl(meanDia, s.len)).toFixed(4);

    const spec = await prisma.specAnalysis.create({
      data: {
        customerPartId: part.id,
        drawingNo: s.pn,
        title: s.name,
        customerName: 'SEPL STD',
        revision: 'R00',
        sheetSize: 'A3',
        scale: '1:1',
        materialNote: 'AS PER BOM',
        productType: 'Shaft',
        overallLengthMm: s.len,
        maxOdMm: s.od,
        generalTolTable: JSON.stringify({ linear: '±0.1', angular: '±0.5°' }),
        notes: 'BREAK ALL SHARP EDGES | REMOVE BURRS',
        estNetWeightKg: estNet,
        estInputWeightKg: estInput,
        overallConfidence: 0.6,
        reviewed: true,
        createdBy: admin.id,
        rawExtract: JSON.stringify({ seeded: true, flags: ['Material shown as "AS PER BOM"'] }),
        items: {
          create: [
            { itemType: 'DIAMETER', label: `Ø${s.od}`, nominalValue: s.od, unit: 'mm', rawText: `Ø${s.od}`, confidence: 0.7, reviewed: true },
            { itemType: 'DIAMETER', label: 'Ø17 m6', nominalValue: 17, unit: 'mm', tolUpper: 0.02, tolLower: 0.01, tolClass: 'm6', rawText: 'Ø17 m6 (+0.02/+0.01)', confidence: 0.7, reviewed: true },
            { itemType: 'LENGTH', label: `${s.len} LONG`, nominalValue: s.len, unit: 'mm', rawText: `${s.len}`, confidence: 0.7, reviewed: true },
            { itemType: 'THREAD', label: 'M16x1.5', nominalValue: 16, unit: 'mm', tolClass: '6g', rawText: 'M16 x 1.5', confidence: 0.6, reviewed: true },
            { itemType: 'CHAMFER', label: '2x45°', nominalValue: 2, unit: 'mm', rawText: '2 x 45°', confidence: 0.6, reviewed: true },
            { itemType: 'UNDERCUT', label: 'Ø14 x 2', nominalValue: 14, unit: 'mm', rawText: 'UNDERCUT Ø14 x 2', confidence: 0.55, reviewed: true },
            { itemType: 'HOLE', label: `Ø${s.hole} THRU`, nominalValue: s.hole, unit: 'mm', rawText: `Ø${s.hole} THRU`, confidence: 0.55, reviewed: true },
            { itemType: 'GDT', label: '⊥ 0.02 A', nominalValue: 0.02, unit: 'mm', datum: 'A', gdtType: 'perpendicularity', rawText: '⊥ 0.02 A', confidence: 0.5, reviewed: true },
          ],
        },
      },
    });

    // one worked RFQ for the first part
    if (s.pn === 'P01273549') {
      const rfq = await prisma.rfq.create({
        data: {
          rfqNumber: '2026/03/0001',
          customerPartId: part.id,
          annualQty: 5000,
          batchQty: 500,
          status: 'DRAFT',
          createdBy: admin.id,
        },
      });
      await prisma.rfqVersion.create({
        data: {
          rfqId: rfq.id,
          revisionNo: 1,
          basedOnPartRevision: 'R00',
          status: 'DRAFT',
          isCurrent: true,
          createdBy: admin.id,
          partAttributes: { create: { netWeightKg: estNet, forgiveLossPct: 12 } },
        },
      });
      await prisma.specAnalysis.update({
        where: { id: spec.id },
        data: { rfqVersionId: (await prisma.rfqVersion.findFirstOrThrow({ where: { rfqId: rfq.id } })).id },
      });
    }
  }

  console.log('✓ Worked examples: P01273549 & P01273550 customer parts + spec analyses, 2026/03/0001');
}

async function main() {
  console.log('🌱 Seeding database…');
  await seedPlatform();
  await seedMasters();
  await seedWorkedExamples();
  console.log('✅ Seed complete');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
