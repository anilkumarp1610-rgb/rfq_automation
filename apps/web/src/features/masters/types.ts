import { ReactNode } from 'react'

export type FieldType = 'text' | 'number' | 'textarea' | 'checkbox' | 'date' | 'select'

export interface FieldDef {
  name: string
  label: string
  type: FieldType
  required?: boolean
  step?: string
  /** static <option> list */
  options?: { value: string; label: string }[]
  /** endpoint whose rows become <option>s */
  optionsResource?: string
  optionLabel?: (row: any) => string
  /** allow an empty choice for a select */
  nullable?: boolean
  defaultValue?: string | number | boolean
  /** keep out of the create/edit form */
  formHidden?: boolean
  /** keep out of the table */
  tableHidden?: boolean
  /** custom table cell */
  cell?: (row: any) => ReactNode
}

/** A per-row "configure related records" action that scopes a child tab. */
export interface DrilldownDef {
  /** button label, e.g. "Size configs" */
  label: string
  /** target tab key within the same group */
  tab: string
  /** the FK field on the target that must equal this row's id */
  targetField: string
  /** breadcrumb label built from this row */
  rowLabel: (row: any) => string
}

/** When a child tab is opened via drill-down, it is locked to one parent row. */
export interface MasterScope {
  field: string
  id: string
  label: string
}

export interface MasterConfig {
  key: string
  title: string
  description?: string
  endpoint: string
  searchable?: boolean
  fields: FieldDef[]
  /** per-row drill-down actions into child tabs */
  drilldowns?: DrilldownDef[]
  /** hide the row delete action (e.g. entities with cascading children) */
  hideDelete?: boolean
  /** allow the ESTIMATOR role to create/edit, not just ADMIN/MANAGER */
  editableByEstimator?: boolean
}

/** One navigation-pane entry: a functional area with one or more tabbed sections. */
export interface MasterGroup {
  key: string
  title: string
  description?: string
  /** sections shown in the tab bar */
  tabs: MasterConfig[]
  /** sections reachable only via a parent row's drill-down */
  hiddenTabs?: MasterConfig[]
}
