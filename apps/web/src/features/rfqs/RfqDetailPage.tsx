import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { RFQ_STATUSES, RFQ_VERSION_STATUSES } from '@rfq/shared'
import { resource, apiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, Textarea } from '@/components/ui/field'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from './StatusBadge'
import CostSheet from './CostSheet'
import SpecAnalysis from './SpecAnalysis'
import SimilarRfqs from './SimilarRfqs'
import QuotationPanel from './QuotationPanel'
import { cn } from '@/lib/utils'

const rfqApi = resource('/rfqs')
const versionApi = resource('/rfq-versions')
const fmtDate = (d?: string | null) => (d ? String(d).slice(0, 10) : '—')

interface AttrForm {
  materialCategoryId: string
  materialShapeId: string
  productTypeId: string
  netWeightKg: string
  forgingLossPct: string
  surfaceFinish: string
  hardness: string
  heatTreatment: string
  dimensions: string
  tolerances: string
  features: string
  reviewed: boolean
}

const emptyAttr: AttrForm = {
  materialCategoryId: '',
  materialShapeId: '',
  productTypeId: '',
  netWeightKg: '',
  forgingLossPct: '',
  surfaceFinish: '',
  hardness: '',
  heatTreatment: '',
  dimensions: '',
  tolerances: '',
  features: '',
  reviewed: false,
}

function attrToForm(a: any): AttrForm {
  if (!a) return { ...emptyAttr }
  return {
    materialCategoryId: a.materialCategoryId ?? '',
    materialShapeId: a.materialShapeId ?? '',
    productTypeId: a.productTypeId ?? '',
    netWeightKg: a.netWeightKg ?? '',
    forgingLossPct: a.forgiveLossPct ?? '',
    surfaceFinish: a.surfaceFinish ?? '',
    hardness: a.hardness ?? '',
    heatTreatment: a.heatTreatment ?? '',
    dimensions: a.dimensions ?? '',
    tolerances: a.tolerances ?? '',
    features: a.features ?? '',
    reviewed: !!a.reviewed,
  }
}

export default function RfqDetailPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const { user } = useAuth()
  const canEdit = !!user?.roles.some((r) => ['ADMIN', 'MANAGER', 'ESTIMATOR'].includes(r))

  const rfqQuery = useQuery({ queryKey: ['rfq', id], queryFn: () => rfqApi.get(id) })
  const rfq = rfqQuery.data as any

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const versions: any[] = rfq?.versions ?? []
  const selected = versions.find((v) => String(v.id) === selectedId) ?? versions.at(-1)

  useEffect(() => {
    if (versions.length && !versions.some((v) => String(v.id) === selectedId)) {
      const current = versions.find((v) => v.isCurrent) ?? versions.at(-1)
      setSelectedId(current ? String(current.id) : null)
    }
  }, [versions, selectedId])

  const [attr, setAttr] = useState<AttrForm>(emptyAttr)
  const [versionStatus, setVersionStatus] = useState('DRAFT')
  useEffect(() => {
    setAttr(attrToForm(selected?.partAttributes))
    setVersionStatus(selected?.status ?? 'DRAFT')
  }, [selected?.id])

  const catQuery = useQuery({
    queryKey: ['options', '/material/categories'],
    queryFn: () => resource('/material/categories').list(),
    staleTime: 60_000,
  })
  const shapeQuery = useQuery({
    queryKey: ['options', '/material/shapes'],
    queryFn: () => resource('/material/shapes').list(),
    staleTime: 60_000,
  })
  const productTypeQuery = useQuery({
    queryKey: ['options', '/product-types'],
    queryFn: () => resource('/product-types').list(),
    staleTime: 60_000,
  })

  const categories = (catQuery.data as any[]) ?? []
  const shapes = (shapeQuery.data as any[]) ?? []
  const productTypes = (productTypeQuery.data as any[]) ?? []

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['rfq', id] })
    qc.invalidateQueries({ queryKey: ['rfqs'] })
  }

  const headerMutation = useMutation({
    mutationFn: (body: any) => rfqApi.update(id, body),
    onSuccess: () => {
      toast.success('RFQ updated')
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const saveVersion = useMutation({
    mutationFn: (body: any) => versionApi.update(String(selected.id), body),
    onSuccess: () => {
      toast.success('Version saved')
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const newVersion = useMutation({
    mutationFn: () =>
      resource(`/rfqs/${id}/versions`).create({
        copyFromVersionId: selected?.id ? String(selected.id) : undefined,
      }),
    onSuccess: () => {
      toast.success('New revision created')
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const part = rfq?.customerPart

  const headerForm = useMemo(
    () => ({
      status: rfq?.status ?? 'DRAFT',
      requiredDate: rfq?.requiredDate ? String(rfq.requiredDate).slice(0, 10) : '',
      annualQty: rfq?.annualQty ?? '',
      batchQty: rfq?.batchQty ?? '',
    }),
    [rfq]
  )
  const [hdr, setHdr] = useState(headerForm)
  useEffect(() => setHdr(headerForm), [headerForm])

  if (rfqQuery.isLoading) return <p>Loading…</p>
  if (!rfq) return <p>RFQ not found.</p>

  function submitAttributes(e: React.FormEvent) {
    e.preventDefault()
    saveVersion.mutate({
      status: versionStatus,
      partAttributes: {
        materialCategoryId: attr.materialCategoryId || null,
        materialShapeId: attr.materialShapeId || null,
        productTypeId: attr.productTypeId || null,
        netWeightKg: attr.netWeightKg === '' ? null : Number(attr.netWeightKg),
        forgingLossPct: attr.forgingLossPct === '' ? null : Number(attr.forgingLossPct),
        surfaceFinish: attr.surfaceFinish || null,
        hardness: attr.hardness || null,
        heatTreatment: attr.heatTreatment || null,
        dimensions: attr.dimensions || null,
        tolerances: attr.tolerances || null,
        features: attr.features || null,
        reviewed: attr.reviewed,
      },
    })
  }

  return (
    <div className="space-y-6">
      <Link to="/rfqs" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:underline">
        <ArrowLeft className="h-4 w-4" /> All RFQs
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{rfq.rfqNumber}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {part?.customer?.code} · {part?.customerPartNumber} — {part?.partName}
            {part?.currentRevision ? ` · part rev ${part.currentRevision}` : ''}
          </p>
        </div>
        <StatusBadge status={rfq.status} />
      </div>

      {/* Header editor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">RFQ header</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault()
              headerMutation.mutate({
                status: hdr.status,
                requiredDate: hdr.requiredDate || null,
                annualQty: hdr.annualQty === '' ? null : Number(hdr.annualQty),
                batchQty: hdr.batchQty === '' ? null : Number(hdr.batchQty),
              })
            }}
          >
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select
                value={hdr.status}
                disabled={!canEdit}
                onChange={(e) => setHdr((s) => ({ ...s, status: e.target.value }))}
              >
                {RFQ_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Required date</Label>
              <Input
                type="date"
                disabled={!canEdit}
                value={hdr.requiredDate}
                onChange={(e) => setHdr((s) => ({ ...s, requiredDate: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Annual qty</Label>
              <Input
                type="number"
                disabled={!canEdit}
                value={hdr.annualQty}
                onChange={(e) => setHdr((s) => ({ ...s, annualQty: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Batch qty</Label>
              <Input
                type="number"
                disabled={!canEdit}
                value={hdr.batchQty}
                onChange={(e) => setHdr((s) => ({ ...s, batchQty: e.target.value }))}
              />
            </div>
            {canEdit && (
              <div className="md:col-span-4">
                <Button type="submit" size="sm" disabled={headerMutation.isPending}>
                  Save header
                </Button>
              </div>
            )}
          </form>
          <p className="text-xs text-slate-400 mt-3">
            RFQ date {fmtDate(rfq.rfqDate)} · currency {rfq.currency}
          </p>
        </CardContent>
      </Card>

      {/* Versions */}
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-600">Revisions</h2>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => newVersion.mutate()}
                disabled={newVersion.isPending}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => setSelectedId(String(v.id))}
              className={cn(
                'w-full rounded-md border p-2 text-left text-sm',
                String(v.id) === String(selected?.id) ? 'border-primary bg-primary/5' : 'bg-white'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">R{v.revisionNo}</span>
                {v.isCurrent && <span className="text-[10px] text-primary">CURRENT</span>}
              </div>
              <div className="text-xs text-slate-500">{v.versionLabel || '—'}</div>
              <div className="mt-1">
                <StatusBadge status={v.status} />
              </div>
            </button>
          ))}
        </div>

        {/* Selected version editor */}
        {selected && (
          <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Revision {selected.revisionNo} — part attributes
              </CardTitle>
              <div className="flex items-center gap-2">
                {!selected.isCurrent && canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => saveVersion.mutate({ makeCurrent: true })}
                  >
                    Make current
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3 md:grid-cols-2" onSubmit={submitAttributes}>
                <Field label="Material grade">
                  <Select
                    disabled={!canEdit}
                    value={attr.materialCategoryId ? String(attr.materialCategoryId) : ''}
                    onChange={(e) => setAttr((s) => ({ ...s, materialCategoryId: e.target.value }))}
                  >
                    <option value="">—</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.gradeCode} {c.materialType ? `(${c.materialType.name})` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Shape">
                  <Select
                    disabled={!canEdit}
                    value={attr.materialShapeId ? String(attr.materialShapeId) : ''}
                    onChange={(e) => setAttr((s) => ({ ...s, materialShapeId: e.target.value }))}
                  >
                    <option value="">—</option>
                    {shapes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Product type">
                  <Select
                    disabled={!canEdit}
                    value={attr.productTypeId ? String(attr.productTypeId) : ''}
                    onChange={(e) => setAttr((s) => ({ ...s, productTypeId: e.target.value }))}
                  >
                    <option value="">—</option>
                    {productTypes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Version status">
                  <Select
                    disabled={!canEdit}
                    value={versionStatus}
                    onChange={(e) => setVersionStatus(e.target.value)}
                  >
                    {RFQ_VERSION_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Net weight (kg)">
                  <Input
                    type="number"
                    step="0.001"
                    disabled={!canEdit}
                    value={attr.netWeightKg}
                    onChange={(e) => setAttr((s) => ({ ...s, netWeightKg: e.target.value }))}
                  />
                </Field>
                <Field label="Forging loss %">
                  <Input
                    type="number"
                    step="0.1"
                    disabled={!canEdit}
                    value={attr.forgingLossPct}
                    onChange={(e) => setAttr((s) => ({ ...s, forgingLossPct: e.target.value }))}
                  />
                </Field>
                <Field label="Surface finish">
                  <Input
                    disabled={!canEdit}
                    value={attr.surfaceFinish}
                    onChange={(e) => setAttr((s) => ({ ...s, surfaceFinish: e.target.value }))}
                  />
                </Field>
                <Field label="Hardness">
                  <Input
                    disabled={!canEdit}
                    value={attr.hardness}
                    onChange={(e) => setAttr((s) => ({ ...s, hardness: e.target.value }))}
                  />
                </Field>
                <Field label="Heat treatment">
                  <Input
                    disabled={!canEdit}
                    value={attr.heatTreatment}
                    onChange={(e) => setAttr((s) => ({ ...s, heatTreatment: e.target.value }))}
                  />
                </Field>
                <div className="md:col-span-2 grid gap-3 md:grid-cols-3">
                  <Field label="Dimensions (JSON / notes)">
                    <Textarea
                      disabled={!canEdit}
                      value={attr.dimensions}
                      onChange={(e) => setAttr((s) => ({ ...s, dimensions: e.target.value }))}
                    />
                  </Field>
                  <Field label="Tolerances">
                    <Textarea
                      disabled={!canEdit}
                      value={attr.tolerances}
                      onChange={(e) => setAttr((s) => ({ ...s, tolerances: e.target.value }))}
                    />
                  </Field>
                  <Field label="Features">
                    <Textarea
                      disabled={!canEdit}
                      value={attr.features}
                      onChange={(e) => setAttr((s) => ({ ...s, features: e.target.value }))}
                    />
                  </Field>
                </div>
                <label className="md:col-span-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    disabled={!canEdit}
                    checked={attr.reviewed}
                    onChange={(e) => setAttr((s) => ({ ...s, reviewed: e.target.checked }))}
                  />
                  Attributes reviewed by estimator
                </label>
                {canEdit && (
                  <div className="md:col-span-2">
                    <Button type="submit" disabled={saveVersion.isPending}>
                      {saveVersion.isPending ? 'Saving…' : 'Save revision'}
                    </Button>
                  </div>
                )}
              </form>

              {selected.costSummary && (
                <p className="mt-4 text-sm text-slate-500">
                  Last computed quote / pc: ₹
                  {Number(selected.costSummary.quotedPricePerPc).toLocaleString('en-IN')}
                </p>
              )}
            </CardContent>
          </Card>

          <SpecAnalysis
            versionId={String(selected.id)}
            canEdit={canEdit}
            onChanged={invalidate}
          />

          <CostSheet
            versionId={String(selected.id)}
            canEdit={canEdit}
            onChanged={invalidate}
          />

          <SimilarRfqs
            versionId={String(selected.id)}
            reference={selected.reference}
            canEdit={canEdit}
            onChanged={invalidate}
          />

          <QuotationPanel
            versionId={String(selected.id)}
            quoteNo={`${rfq.rfqNumber}-R${selected.revisionNo}`}
            hasCost={!!selected.costSummary}
            status={selected.status}
            canEdit={canEdit}
            onChanged={invalidate}
          />
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
