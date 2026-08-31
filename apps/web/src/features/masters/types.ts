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

export interface MasterConfig {
  key: string
  title: string
  description?: string
  endpoint: string
  searchable?: boolean
  fields: FieldDef[]
  /** hide the row delete action (e.g. entities with cascading children) */
  hideDelete?: boolean
  /** allow the ESTIMATOR role to create/edit, not just ADMIN/MANAGER */
  editableByEstimator?: boolean
}
