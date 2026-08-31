import { PROCESS_TYPES, COSTING_METHODS, QC_METHODS, TRANSPORT_MODES, COST_MODES } from '@rfq/shared'
import type { MasterConfig, MasterGroup } from './types'

const asOptions = (arr: readonly string[]) => arr.map((v) => ({ value: v, label: v }))

const effectiveDates = [
  { name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true } as const,
  { name: 'effectiveTo', label: 'Effective to', type: 'date' } as const,
]

// ---------------------------------------------------------------------------
// Section definitions
// ---------------------------------------------------------------------------
const customers: MasterConfig = {
  key: 'customers',
  title: 'Customers',
  description: 'Customer master with rating (1–5) that drives the margin recommendation.',
  endpoint: '/customers',
  searchable: true,
  fields: [
    { name: 'code', label: 'Code', type: 'text', required: true },
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'rating', label: 'Rating (1–5)', type: 'number', required: true, defaultValue: 3, step: '1' },
    { name: 'commercialScore', label: 'Commercial score', type: 'number', tableHidden: true },
    { name: 'paymentTerms', label: 'Payment terms', type: 'text', tableHidden: true },
    { name: 'currency', label: 'Currency', type: 'text', defaultValue: 'INR' },
    { name: 'gstNo', label: 'GST no.', type: 'text', tableHidden: true },
    { name: 'taxApplicable', label: 'Tax applicable', type: 'checkbox', defaultValue: true, tableHidden: true },
    { name: 'deliveryLocation', label: 'Delivery location', type: 'text' },
    { name: 'address', label: 'Address', type: 'textarea', tableHidden: true },
    { name: 'contactName', label: 'Contact name', type: 'text', tableHidden: true },
    { name: 'contactEmail', label: 'Contact email', type: 'text', tableHidden: true },
  ],
}

const marginMap: MasterConfig = {
  key: 'customer-margin-map',
  title: 'Rating → Margin',
  description: 'Base margin % suggested for each customer rating.',
  endpoint: '/customer-margin-map',
  fields: [
    { name: 'rating', label: 'Rating (1–5)', type: 'number', required: true, step: '1' },
    { name: 'baseMarginPct', label: 'Base margin %', type: 'number', required: true, step: '0.01' },
    ...effectiveDates,
  ],
}

const materialTypes: MasterConfig = {
  key: 'material-types',
  title: 'Types',
  description: 'Top-level material families (Carbon Steel, Alloy Steel, …).',
  endpoint: '/material/types',
  searchable: true,
  fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
}

const grades: MasterConfig = {
  key: 'material-categories',
  title: 'Grades',
  description: 'Material grades under each type — with density for weight derivation.',
  endpoint: '/material/categories',
  searchable: true,
  drilldowns: [
    {
      label: 'Size configs',
      tab: 'material-size-configs',
      targetField: 'materialCategoryId',
      rowLabel: (r) => r.gradeCode,
    },
  ],
  fields: [
    {
      name: 'materialTypeId',
      label: 'Material type',
      type: 'select',
      required: true,
      optionsResource: '/material/types',
      optionLabel: (r) => r.name,
      cell: (r) => r.materialType?.name ?? '—',
    },
    { name: 'gradeCode', label: 'Grade code', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'text' },
    { name: 'densityKgM3', label: 'Density (kg/m³)', type: 'number', defaultValue: 7850 },
  ],
}

const shapes: MasterConfig = {
  key: 'material-shapes',
  title: 'Shapes',
  description: 'Stock shapes. Use the row action to configure sizes for a shape.',
  endpoint: '/material/shapes',
  searchable: true,
  drilldowns: [
    {
      label: 'Size configs',
      tab: 'material-size-configs',
      targetField: 'materialShapeId',
      rowLabel: (r) => r.name,
    },
  ],
  fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
}

const sizeConfigs: MasterConfig = {
  key: 'material-size-configs',
  title: 'Size configs',
  description: 'A grade × shape × dimensions row. Configure its prices from the row action.',
  endpoint: '/material/size-configs',
  drilldowns: [
    {
      label: 'Prices',
      tab: 'material-prices',
      targetField: 'materialSizeConfigId',
      rowLabel: (r) =>
        `${r.materialCategory?.gradeCode ?? '?'} · ${r.materialShape?.name ?? '?'} · OD${r.odMm ?? '-'}`,
    },
  ],
  fields: [
    {
      name: 'materialCategoryId',
      label: 'Grade',
      type: 'select',
      required: true,
      optionsResource: '/material/categories',
      optionLabel: (r) => r.gradeCode,
      cell: (r) => r.materialCategory?.gradeCode ?? '—',
    },
    {
      name: 'materialShapeId',
      label: 'Shape',
      type: 'select',
      required: true,
      optionsResource: '/material/shapes',
      optionLabel: (r) => r.name,
      cell: (r) => r.materialShape?.name ?? '—',
    },
    { name: 'odMm', label: 'OD (mm)', type: 'number' },
    { name: 'idMm', label: 'ID (mm)', type: 'number' },
    { name: 'widthMm', label: 'Width (mm)', type: 'number', tableHidden: true },
    { name: 'thicknessMm', label: 'Thickness (mm)', type: 'number', tableHidden: true },
    { name: 'lengthMm', label: 'Length (mm)', type: 'number' },
    { name: 'uom', label: 'UOM', type: 'text', defaultValue: 'kg' },
    { name: 'standardWeightPerUnit', label: 'Std wt / unit', type: 'number', tableHidden: true },
  ],
}

const prices: MasterConfig = {
  key: 'material-prices',
  title: 'Prices',
  description: 'Effective-dated ₹/kg per size config — a new price auto-closes the prior one.',
  endpoint: '/material/prices',
  fields: [
    {
      name: 'materialSizeConfigId',
      label: 'Size config',
      type: 'select',
      required: true,
      optionsResource: '/material/size-configs',
      optionLabel: (r) =>
        `${r.materialCategory?.gradeCode ?? '?'} · ${r.materialShape?.name ?? '?'} · OD${r.odMm ?? '-'}`,
      cell: (r) =>
        `${r.materialSizeConfig?.materialCategory?.gradeCode ?? '?'} · ${r.materialSizeConfig?.materialShape?.name ?? '?'}`,
    },
    { name: 'ratePerKg', label: 'Rate / kg', type: 'number', required: true, step: '0.01' },
    { name: 'currency', label: 'Currency', type: 'text', defaultValue: 'INR' },
    { name: 'supplier', label: 'Supplier', type: 'text' },
    { name: 'moq', label: 'MOQ', type: 'number', tableHidden: true },
    ...effectiveDates,
  ],
}

const handling: MasterConfig = {
  key: 'handling-config',
  title: 'Handling',
  description: 'Procurement %, transportation rate and storage % applied on material cost.',
  endpoint: '/handling-config',
  fields: [
    {
      name: 'materialTypeId',
      label: 'Material type (blank = global)',
      type: 'select',
      nullable: true,
      optionsResource: '/material/types',
      optionLabel: (r) => r.name,
      cell: (r) => r.materialType?.name ?? 'Global',
    },
    { name: 'procurementPct', label: 'Procurement %', type: 'number', defaultValue: 0, step: '0.01' },
    { name: 'storagePct', label: 'Storage %', type: 'number', defaultValue: 0, step: '0.01' },
    {
      name: 'transportationMode',
      label: 'Transportation mode',
      type: 'select',
      required: true,
      options: asOptions(TRANSPORT_MODES),
      defaultValue: 'FIXED',
    },
    {
      name: 'transportationRate',
      label: 'Transportation value (₹/pc, ₹/kg, ₹/lot or %)',
      type: 'number',
      defaultValue: 0,
      step: '0.01',
    },
    {
      name: 'packingMode',
      label: 'Packing mode',
      type: 'select',
      required: true,
      options: asOptions(COST_MODES),
      defaultValue: 'FIXED',
    },
    { name: 'packingCost', label: 'Packing value (₹/pc or %)', type: 'number', defaultValue: 0, step: '0.01' },
    ...effectiveDates,
  ],
}

const processes: MasterConfig = {
  key: 'processes',
  title: 'Processes',
  description: 'Machine / manual / subcontract operations and their costing method.',
  endpoint: '/processes',
  searchable: true,
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'processType', label: 'Process type', type: 'select', required: true, options: asOptions(PROCESS_TYPES) },
    { name: 'costingMethod', label: 'Costing method', type: 'select', required: true, options: asOptions(COSTING_METHODS) },
    { name: 'defaultRate', label: 'Default rate', type: 'number', step: '0.01' },
    { name: 'uom', label: 'UOM', type: 'text', required: true, defaultValue: 'pc' },
    { name: 'description', label: 'Description', type: 'textarea', tableHidden: true },
  ],
}

const machines: MasterConfig = {
  key: 'machines',
  title: 'Machines',
  description: 'Hourly rate is the sum of the build-up components below.',
  endpoint: '/machines',
  searchable: true,
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'type', label: 'Type', type: 'text', required: true },
    { name: 'depreciationHr', label: 'Depreciation / hr', type: 'number', defaultValue: 0, step: '0.01' },
    { name: 'powerHr', label: 'Power / hr', type: 'number', defaultValue: 0, step: '0.01' },
    { name: 'maintenanceHr', label: 'Maintenance / hr', type: 'number', defaultValue: 0, step: '0.01' },
    { name: 'operatorHr', label: 'Operator / hr', type: 'number', defaultValue: 0, step: '0.01' },
    { name: 'toolingHr', label: 'Tooling / hr', type: 'number', defaultValue: 0, step: '0.01' },
    { name: 'overheadHr', label: 'Overhead / hr', type: 'number', defaultValue: 0, step: '0.01' },
    { name: 'hourlyRate', label: 'Hourly rate (derived)', type: 'number', formHidden: true },
  ],
}

const productTypes: MasterConfig = {
  key: 'product-types',
  title: 'Product Types',
  description: 'Part classification used in analysis and history reference.',
  endpoint: '/product-types',
  searchable: true,
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea' },
  ],
}

const qc: MasterConfig = {
  key: 'qc-config',
  title: 'QC',
  description: 'Drives the auto-derived QC cost.',
  endpoint: '/qc-config',
  fields: [
    { name: 'method', label: 'Method', type: 'select', required: true, options: asOptions(QC_METHODS), defaultValue: 'PCT_OF_MFG' },
    { name: 'qcPct', label: 'QC %', type: 'number', required: true, defaultValue: 5, step: '0.01' },
    { name: 'inspectionStandards', label: 'Inspection standards (JSON)', type: 'textarea', tableHidden: true },
    ...effectiveDates,
  ],
}

const overhead: MasterConfig = {
  key: 'overhead-config',
  title: 'Overhead / Admin',
  description: 'Administration % of manufacturing cost.',
  endpoint: '/overhead-config',
  fields: [
    { name: 'adminPct', label: 'Admin %', type: 'number', required: true, step: '0.01' },
    ...effectiveDates,
  ],
}

// ---------------------------------------------------------------------------
// Navigation groups — one nav-pane entry each
// ---------------------------------------------------------------------------
export const MASTER_GROUPS: MasterGroup[] = [
  {
    key: 'customers',
    title: 'Customer Master',
    description: 'Customers and the rating-driven margin map.',
    tabs: [customers, marginMap],
  },
  {
    key: 'material',
    title: 'Material Master',
    description:
      'Material type → grade → shape → size config → price. Use the row actions to drill into the child level.',
    tabs: [materialTypes, grades, shapes, handling],
    hiddenTabs: [sizeConfigs, prices],
  },
  {
    key: 'process',
    title: 'Process & Machine',
    description: 'Manufacturing processes and the machine hour-rate build-up.',
    tabs: [processes, machines],
  },
  {
    key: 'config',
    title: 'Costing Configuration',
    description: 'Product types, QC rule and administration overhead.',
    tabs: [productTypes, qc, overhead],
  },
]

export const MASTER_GROUP_BY_KEY = Object.fromEntries(MASTER_GROUPS.map((g) => [g.key, g]))

/** Flat list of every section, for lookups. */
export const ALL_MASTERS: MasterConfig[] = MASTER_GROUPS.flatMap((g) => [
  ...g.tabs,
  ...(g.hiddenTabs ?? []),
])
