import { useMemo, useState } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Search, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { resource, apiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, Textarea } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import type { DrilldownDef, FieldDef, MasterConfig, MasterScope } from './types'

type Row = Record<string, any>

const isBlank = (v: unknown) => v === '' || v === null || v === undefined

function toFormValue(field: FieldDef, raw: unknown) {
  if (field.type === 'checkbox') return raw ?? field.defaultValue ?? false
  if (field.type === 'date') return raw ? String(raw).slice(0, 10) : ''
  if (isBlank(raw)) return field.defaultValue ?? ''
  return raw
}

function buildPayload(fields: FieldDef[], form: Row, scope?: MasterScope): Row {
  const out: Row = {}
  for (const f of fields) {
    if (f.formHidden) continue
    const v = form[f.name]
    if (f.type === 'checkbox') {
      out[f.name] = !!v
    } else if (f.type === 'number') {
      if (!isBlank(v)) out[f.name] = Number(v)
    } else if (f.type === 'select' && f.nullable) {
      out[f.name] = isBlank(v) ? null : v
    } else if (!isBlank(v)) {
      out[f.name] = v
    }
  }
  if (scope) out[scope.field] = scope.id
  return out
}

interface MasterPageProps {
  config: MasterConfig
  /** locks the list + form to one parent row (drill-down) */
  scope?: MasterScope
  /** open a child tab scoped to a row */
  onDrill?: (dd: DrilldownDef, row: Row) => void
  /** rendered inside a group tab shell — suppress the standalone page header */
  embedded?: boolean
}

export default function MasterPage({ config, scope, onDrill, embedded }: MasterPageProps) {
  const { user, canEditMasters } = useAuth()
  const canEdit = config.editableByEstimator
    ? !!user?.roles.some((r) => ['ADMIN', 'MANAGER', 'ESTIMATOR'].includes(r))
    : canEditMasters
  const qc = useQueryClient()
  const api = useMemo(() => resource(config.endpoint), [config.endpoint])

  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Row | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Row>({})

  const listParams = () => ({
    ...(config.searchable && search ? { search } : {}),
    ...(scope ? { [scope.field]: scope.id } : {}),
  })
  const listQuery = useQuery({
    queryKey: ['master', config.key, scope?.id ?? '', config.searchable ? search : ''],
    queryFn: () => api.list(listParams()),
  })

  // Fetch option lists for every distinct select-with-resource field.
  const optionResources = useMemo(
    () => [...new Set(config.fields.filter((f) => f.optionsResource).map((f) => f.optionsResource!))],
    [config]
  )
  const optionQueries = useQueries({
    queries: optionResources.map((ep) => ({
      queryKey: ['options', ep],
      queryFn: () => resource(ep).list(),
      staleTime: 60_000,
    })),
  })
  const optionsByResource = useMemo(() => {
    const map: Record<string, Row[]> = {}
    optionResources.forEach((ep, i) => (map[ep] = (optionQueries[i].data as Row[]) ?? []))
    return map
  }, [optionResources, optionQueries])

  const saveMutation = useMutation({
    mutationFn: (payload: Row) =>
      editing?.id ? api.update(String(editing.id), payload) : api.create(payload),
    onSuccess: () => {
      toast.success(editing?.id ? 'Updated' : 'Created')
      qc.invalidateQueries({ queryKey: ['master', config.key] })
      qc.invalidateQueries({ queryKey: ['options', config.endpoint] })
      setOpen(false)
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => {
      toast.success('Deleted')
      qc.invalidateQueries({ queryKey: ['master', config.key] })
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const tableFields = config.fields.filter((f) => !f.tableHidden && f.name !== scope?.field)

  function openForm(row: Row | null) {
    setEditing(row)
    const initial: Row = {}
    for (const f of config.fields) initial[f.name] = toFormValue(f, row?.[f.name])
    if (scope && !row) initial[scope.field] = scope.id
    setForm(initial)
    setOpen(true)
  }

  function renderCell(field: FieldDef, row: Row) {
    if (field.cell) return field.cell(row)
    const v = row[field.name]
    if (field.type === 'checkbox') return v ? 'Yes' : 'No'
    if (field.type === 'date') return v ? String(v).slice(0, 10) : '—'
    if (isBlank(v)) return '—'
    if (field.type === 'select' && field.optionsResource && field.optionLabel) {
      const opt = optionsByResource[field.optionsResource]?.find((o) => String(o.id) === String(v))
      return opt ? field.optionLabel(opt) : String(v)
    }
    return String(v)
  }

  function fieldOptions(field: FieldDef) {
    if (field.options) return field.options
    if (field.optionsResource && field.optionLabel) {
      return (optionsByResource[field.optionsResource] ?? []).map((o) => ({
        value: String(o.id),
        label: field.optionLabel!(o),
      }))
    }
    return []
  }

  const rows = (listQuery.data as Row[]) ?? []
  const drilldowns = config.drilldowns ?? []
  const hasActions = canEdit || (drilldowns.length > 0 && !!onDrill)
  const colSpan = tableFields.length + 1 + (hasActions ? 1 : 0)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          {!embedded && <h1 className="text-2xl font-bold">{config.title}</h1>}
          {config.description && <p className="text-sm text-muted-foreground">{config.description}</p>}
        </div>
        {canEdit && (
          <Button onClick={() => openForm(null)}>
            <Plus className="h-4 w-4 mr-1" /> New
          </Button>
        )}
      </div>

      {config.searchable && (
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {tableFields.map((f) => (
                <TableHead key={f.name}>{f.label}</TableHead>
              ))}
              <TableHead className="w-24">Status</TableHead>
              {hasActions && <TableHead className="w-32 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={colSpan}>Loading…</TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-muted-foreground">
                  No records.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={String(row.id)}>
                  {tableFields.map((f) => (
                    <TableCell key={f.name}>{renderCell(f, row)}</TableCell>
                  ))}
                  <TableCell>
                    {row.isActive === undefined ? (
                      '—'
                    ) : row.isActive === false ? (
                      <Badge variant="destructive">Inactive</Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )}
                  </TableCell>
                  {hasActions && (
                    <TableCell className="text-right whitespace-nowrap">
                      {onDrill &&
                        drilldowns.map((dd) => (
                          <Button
                            key={dd.tab}
                            variant="ghost"
                            size="sm"
                            className="text-primary"
                            onClick={() => onDrill(dd, row)}
                          >
                            {dd.label} <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                          </Button>
                        ))}
                      {canEdit && (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => openForm(row)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {!config.hideDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (confirm('Delete this record?'))
                                  deleteMutation.mutate(String(row.id))
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          )}
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? 'Edit' : 'New'} {config.title.replace(/s$/, '')}
            </DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              saveMutation.mutate(buildPayload(config.fields, form, scope))
            }}
          >
            {config.fields
              .filter((f) => !f.formHidden)
              .map((f) => {
                const locked = scope?.field === f.name
                return (
                  <div key={f.name} className="grid gap-1.5">
                    <Label htmlFor={f.name}>
                      {f.label}
                      {f.required && <span className="text-red-500"> *</span>}
                    </Label>
                    {locked ? (
                      <Input id={f.name} value={scope!.label} disabled />
                    ) : f.type === 'textarea' ? (
                      <Textarea
                        id={f.name}
                        value={form[f.name] ?? ''}
                        onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                      />
                    ) : f.type === 'select' ? (
                      <Select
                        id={f.name}
                        value={form[f.name] ?? ''}
                        required={f.required}
                        onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                      >
                        <option value="">{f.nullable ? '(none / global)' : 'Select…'}</option>
                        {fieldOptions(f).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    ) : f.type === 'checkbox' ? (
                      <input
                        id={f.name}
                        type="checkbox"
                        className="h-4 w-4"
                        checked={!!form[f.name]}
                        onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.checked }))}
                      />
                    ) : (
                      <Input
                        id={f.name}
                        type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                        step={f.step}
                        required={f.required}
                        value={form[f.name] ?? ''}
                        onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                      />
                    )}
                  </div>
                )
              })}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
