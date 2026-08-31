import type { MasterConfig } from '@/features/masters/types'

export const customerPartConfig: MasterConfig = {
  key: 'customer-parts',
  title: 'Customer Parts',
  description:
    'Customer part numbers — the anchor that RFQ revisions and saved spec data hang off.',
  endpoint: '/customer-parts',
  searchable: true,
  hideDelete: true,
  editableByEstimator: true,
  fields: [
    {
      name: 'customerId',
      label: 'Customer',
      type: 'select',
      required: true,
      optionsResource: '/customers',
      optionLabel: (r) => `${r.code} — ${r.name}`,
      cell: (r) => r.customer?.code ?? '—',
    },
    { name: 'customerPartNumber', label: 'Part number', type: 'text', required: true },
    { name: 'partName', label: 'Part name', type: 'text', required: true },
    {
      name: 'productTypeId',
      label: 'Product type',
      type: 'select',
      nullable: true,
      optionsResource: '/product-types',
      optionLabel: (r) => r.name,
      cell: (r) => r.productType?.name ?? '—',
    },
    { name: 'drawingNo', label: 'Drawing no.', type: 'text' },
    { name: 'currentRevision', label: 'Current rev', type: 'text' },
    {
      name: '_count',
      label: 'RFQs',
      type: 'text',
      formHidden: true,
      cell: (r) => r._count?.rfqs ?? 0,
    },
  ],
}
