import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Calculator } from 'lucide-react'
import { toast } from 'sonner'
import { COSTING_METHODS } from '@rfq/shared'
import { resource, apiError, apiClient } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/field'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

const versionApi = resource('/rfq-versions')
const money = (n: any) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

interface ProcLine {
  processId: string
  machineId: string
  method: string
  quantityOrTime: string
  rate: string
}
const emptyLine: ProcLine = { processId: '', machineId: '', method: '', quantityOrTime: '0', rate: '0' }

export default function CostSheet({
  versionId,
  canEdit,
  onChanged,
}: {
  versionId: string
  canEdit: boolean
  onChanged: () => void
}) {
  const qc = useQueryClient()
  const versionQuery = useQuery({
    queryKey: ['rfq-version', versionId],
    queryFn: () => versionApi.get(versionId),
  })
  const processesQuery = useQuery({
    queryKey: ['options', '/processes'],
    queryFn: () => resource('/processes').list(),
    staleTime: 60_000,
  })
  const machinesQuery = useQuery({
    queryKey: ['options', '/machines'],
    queryFn: () => resource('/machines').list(),
    staleTime: 60_000,
  })
  const sizeConfigQuery = useQuery({
    queryKey: ['options', '/material/size-configs'],
    queryFn: () => resource('/material/size-configs').list(),
    staleTime: 60_000,
  })

  const version = versionQuery.data as any
  const processes = (processesQuery.data as any[]) ?? []
  const machines = (machinesQuery.data as any[]) ?? []
  const sizeConfigs = (sizeConfigQuery.data as any[]) ?? []
  const processById = useMemo(
    () => new Map(processes.map((p) => [String(p.id), p])),
    [processes]
  )

  const [lines, setLines] = useState<ProcLine[]>([])
  const [material, setMaterial] = useState({
    materialSizeConfigId: '',
    inputWeightKg: '',
    ratePerKg: '',
    wastagePct: '0',
  })
  const [margin, setMargin] = useState({ marginAdjustmentPct: '', marginOverridePct: '', quantity: '' })
  const [result, setResult] = useState<any>(null)

  useEffect(() => {
    if (!version) return
    setLines(
      (version.processes ?? []).map((p: any) => ({
        processId: String(p.processId),
        machineId: p.machineId ? String(p.machineId) : '',
        method: p.method ?? '',
        quantityOrTime: String(p.quantityOrTime ?? 0),
        rate: String(p.rate ?? 0),
      }))
    )
    const m = version.materials?.[0]
    setMaterial({
      materialSizeConfigId: m ? String(m.materialSizeConfigId) : '',
      inputWeightKg: m ? String(m.inputWeightKg) : '',
      ratePerKg: m ? String(m.ratePerKg) : '',
      wastagePct: m ? String(m.wastagePct ?? 0) : '0',
    })
  }, [version?.id])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['rfq-version', versionId] })
    onChanged()
  }

  const saveLines = useMutation({
    mutationFn: () =>
      putJson(`/rfq-versions/${versionId}/processes`, {
        lines: lines
          .filter((l) => l.processId)
          .map((l, i) => ({
            processId: l.processId,
            machineId: l.machineId || null,
            method: l.method || undefined,
            quantityOrTime: Number(l.quantityOrTime || 0),
            rate: Number(l.rate || 0),
            sequence: i + 1,
          })),
      }),
    onSuccess: () => {
      toast.success('Process lines saved')
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const saveMaterial = useMutation({
    mutationFn: (clear?: boolean) =>
      putJson(`/rfq-versions/${versionId}/materials`, {
        line:
          clear || !material.materialSizeConfigId
            ? null
            : {
                materialSizeConfigId: material.materialSizeConfigId,
                inputWeightKg: Number(material.inputWeightKg || 0),
                ratePerKg: Number(material.ratePerKg || 0),
                wastagePct: Number(material.wastagePct || 0),
              },
      }),
    onSuccess: () => {
      toast.success('Material line saved')
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const compute = useMutation({
    mutationFn: () =>
      resource(`/rfq-versions/${versionId}/compute` as string).create({
        marginAdjustmentPct: margin.marginAdjustmentPct || undefined,
        marginOverridePct: margin.marginOverridePct === '' ? undefined : Number(margin.marginOverridePct),
        quantity: margin.quantity || undefined,
      }),
    onSuccess: (data: any) => {
      setResult(data)
      toast.success('Cost computed')
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  if (versionQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading cost sheet…</p>

  const summary = result?.summary ?? deriveSummary(version?.costSummary)
  const warnings: string[] = result?.warnings ?? []

  return (
    <div className="space-y-4">
      {/* Material line */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Material</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <div className="md:col-span-2 grid gap-1.5">
            <Label>Size config</Label>
            <Select
              disabled={!canEdit}
              value={material.materialSizeConfigId}
              onChange={(e) => setMaterial((s) => ({ ...s, materialSizeConfigId: e.target.value }))}
            >
              <option value="">— (resolve from part attributes on compute)</option>
              {sizeConfigs.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.materialCategory?.gradeCode} · {sc.materialShape?.name} · OD{sc.odMm ?? '-'}
                </option>
              ))}
            </Select>
          </div>
          <NumberField label="Input wt (kg)" v={material.inputWeightKg} disabled={!canEdit} onChange={(v) => setMaterial((s) => ({ ...s, inputWeightKg: v }))} />
          <NumberField label="Rate / kg" v={material.ratePerKg} disabled={!canEdit} onChange={(v) => setMaterial((s) => ({ ...s, ratePerKg: v }))} />
          <NumberField label="Wastage %" v={material.wastagePct} disabled={!canEdit} onChange={(v) => setMaterial((s) => ({ ...s, wastagePct: v }))} />
          {canEdit && (
            <div className="md:col-span-5 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => saveMaterial.mutate(undefined)}>
                Save material
              </Button>
              <Button size="sm" variant="ghost" onClick={() => saveMaterial.mutate(true)}>
                Clear
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Process lines */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Process lines</CardTitle>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setLines((l) => [...l, { ...emptyLine }])}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Row
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Process</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Machine</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Qty / time</TableHead>
                <TableHead>Rate</TableHead>
                {canEdit && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No process lines.
                  </TableCell>
                </TableRow>
              )}
              {lines.map((l, i) => {
                const proc = processById.get(l.processId)
                const setLine = (patch: Partial<ProcLine>) =>
                  setLines((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)))
                return (
                  <TableRow key={i}>
                    <TableCell>
                      <Select
                        disabled={!canEdit}
                        value={l.processId}
                        onChange={(e) => {
                          const p = processById.get(e.target.value)
                          setLine({ processId: e.target.value, method: l.method || p?.costingMethod || '' })
                        }}
                      >
                        <option value="">Select…</option>
                        {processes.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{proc?.processType ?? '—'}</TableCell>
                    <TableCell>
                      <Select
                        disabled={!canEdit}
                        value={l.machineId}
                        onChange={(e) => setLine({ machineId: e.target.value })}
                      >
                        <option value="">—</option>
                        {machines.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        disabled={!canEdit}
                        value={l.method}
                        onChange={(e) => setLine({ method: e.target.value })}
                      >
                        {COSTING_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="w-24"
                        type="number"
                        disabled={!canEdit}
                        value={l.quantityOrTime}
                        onChange={(e) => setLine({ quantityOrTime: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="w-24"
                        type="number"
                        disabled={!canEdit}
                        value={l.rate}
                        onChange={(e) => setLine({ rate: e.target.value })}
                        placeholder="auto"
                      />
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setLines((arr) => arr.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {canEdit && (
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={() => saveLines.mutate()} disabled={saveLines.isPending}>
                Save process lines
              </Button>
              <span className="text-xs text-muted-foreground ml-2">
                Leave rate blank to use the machine-hour rate / process default.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Compute */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Compute estimate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <NumberField
              label="Margin adjustment %"
              v={margin.marginAdjustmentPct}
              disabled={!canEdit}
              onChange={(v) => setMargin((s) => ({ ...s, marginAdjustmentPct: v }))}
            />
            <NumberField
              label="Margin override %"
              v={margin.marginOverridePct}
              disabled={!canEdit}
              onChange={(v) => setMargin((s) => ({ ...s, marginOverridePct: v }))}
            />
            <NumberField
              label="Quantity (blank = annual)"
              v={margin.quantity}
              disabled={!canEdit}
              onChange={(v) => setMargin((s) => ({ ...s, quantity: v }))}
            />
          </div>
          {canEdit && (
            <Button onClick={() => compute.mutate()} disabled={compute.isPending}>
              <Calculator className="h-4 w-4 mr-1" />
              {compute.isPending ? 'Computing…' : 'Compute cost'}
            </Button>
          )}

          {warnings.length > 0 && (
            <ul className="text-xs text-amber-700 bg-amber-50 rounded-md p-3 space-y-1">
              {warnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          )}

          {summary && (
            <div className="rounded-lg border">
              <Table>
                <TableBody>
                  {[
                    ['Material', summary.materialCost],
                    ['Handling', summary.handlingCost],
                    ['Machining', summary.machiningCost],
                    ['Manual', summary.manualCost],
                    ['Subcontract', summary.subcontractCost],
                    ['QC (auto)', summary.qcCost],
                    ['Manufacturing cost', summary.mfgCost, true],
                    ['Administration', summary.adminCost],
                    ['Subtotal', summary.subtotal, true],
                    [
                      `Margin (${summary.marginPct}%${
                        summary.aiRecommendedMarginPct != null &&
                        Number(summary.aiRecommendedMarginPct) !== Number(summary.marginPct)
                          ? `, rec. ${summary.aiRecommendedMarginPct}%`
                          : ''
                      })`,
                      summary.marginAmount,
                    ],
                    ['Quoted price / pc', summary.quotedPricePerPc, true],
                    ['Total quote', summary.totalQuote, true],
                  ].map(([label, value, strong]: any) => (
                    <TableRow key={label}>
                      <TableCell className={strong ? 'font-semibold' : ''}>{label}</TableCell>
                      <TableCell className={`text-right ${strong ? 'font-semibold' : ''}`}>
                        {money(value)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function NumberField({
  label,
  v,
  onChange,
  disabled,
}: {
  label: string
  v: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input type="number" value={v} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

/** PUT helper (the generic `resource` only does collection-style paths). */
function putJson(path: string, body: unknown) {
  return apiClient.put(path, body).then((r) => r.data)
}

const deriveSummary = (cs: any) => cs ?? null
