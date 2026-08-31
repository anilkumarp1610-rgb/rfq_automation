import { z } from 'zod';

export const ROLES = ['ADMIN', 'ESTIMATOR', 'MANAGER', 'VIEWER'] as const;
export const RoleCode = z.enum(ROLES);
export type RoleCode = z.infer<typeof RoleCode>;

export const PROCESS_TYPES = ['MACHINE', 'MANUAL', 'SUBCONTRACT'] as const;
export const ProcessType = z.enum(PROCESS_TYPES);
export type ProcessType = z.infer<typeof ProcessType>;

export const COSTING_METHODS = [
  'CYCLE_TIME',
  'PER_KG',
  'PER_STROKE',
  'PER_OP',
  'FLAT_PC',
  'PER_LOT',
] as const;
export const CostingMethod = z.enum(COSTING_METHODS);
export type CostingMethod = z.infer<typeof CostingMethod>;

export const QC_METHODS = ['PCT_OF_MFG', 'PER_INSPECTION', 'RULE'] as const;
export const QcMethod = z.enum(QC_METHODS);
export type QcMethod = z.infer<typeof QcMethod>;

export const TRANSPORT_UOMS = ['per_kg', 'per_lot'] as const;
export const TransportationUom = z.enum(TRANSPORT_UOMS);
export type TransportationUom = z.infer<typeof TransportationUom>;

export const RFQ_STATUSES = ['DRAFT', 'COSTED', 'QUOTED', 'WON', 'LOST'] as const;
export const RfqStatus = z.enum(RFQ_STATUSES);
export type RfqStatus = z.infer<typeof RfqStatus>;

export const RFQ_VERSION_STATUSES = ['DRAFT', 'COSTED', 'QUOTED', 'WON', 'LOST'] as const;
export const RfqVersionStatus = z.enum(RFQ_VERSION_STATUSES);
export type RfqVersionStatus = z.infer<typeof RfqVersionStatus>;

export const SPEC_ITEM_TYPES = [
  'DIAMETER',
  'LENGTH',
  'THREAD',
  'HOLE',
  'CHAMFER',
  'UNDERCUT',
  'GROOVE',
  'GDT',
  'SURFACE_FINISH',
  'TOLERANCE',
  'ACROSS_FLATS',
  'NOTE',
] as const;
export const SpecItemType = z.enum(SPEC_ITEM_TYPES);
export type SpecItemType = z.infer<typeof SpecItemType>;
