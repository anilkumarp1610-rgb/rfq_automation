import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Trash2, Plus, RefreshCw, Check, Download, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { SPEC_ITEM_TYPES } from '@rfq/shared'
import { apiClient, apiError, downloadFile } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

type Row = Record<string, any>

const get = (p: string) => apiClient.get(p).then((r) => r.data)

const HEADER_FIELDS: [string, string][] = [
  ['drawingNo', 'Drawing no.'],
  ['title', 'Title'],
  ['customerName', 'Customer'],
  ['revision', 'Revision'],
  ['sheetSize', 'Sheet'],
  ['scale', 'Scale'],
  ['materialNote', 'Material note'],
  ['productType', 'Product type'],
  ['sectionView', 'Section view'],
]

const ITEM_COLS: [string, string][] = [
  ['label', 'Label'],
  ['nominalValue', 'Nominal'],
  ['unit', 'Unit'],
  ['tolUpper', 'Tol +'],
  ['tolLower', 'Tol −'],
  ['tolClass', 'Fit/class'],
  ['datum', 'Datum'],
  ['gdtType', 'GD&T'],
  ['rawText', 'Raw text'],
]

export default function SpecAnalysis({
  versionId,
  canEdit,
  onChanged,
}: {
  versionId: string
  canEdit: boolean
  onChanged: () => void
}) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const specQuery = useQuery({
    queryKey: ['spec', versionId],
    queryFn: async () => {
      try {
        return await get(`/rfq-versions/${versionId}/spec`)
      } catch (e: any) {
        if (e?.response?.status === 404) return null
        throw e
      }
    },
    retry: false,
  })
  const attachQuery = useQuery({
    queryKey: ['spec-attachments', versionId],
    queryFn: () => get(`/rfq-versions/${versionId}/attachments`),
  })

  const spec = specQuery.data as Row | null
  const attachments = (attachQuery.data as Row[]) ?? []

  const [header, setHeader] = useState<Row>({})
  const [items, setItems] = useState<Row[]>([])
  const [estNet, setEstNet] = useState('')
  const [flags, setFlags] = useState<string[]>([])
  const [mock, setMock] = useState(false)

  useEffect(() => {
    if (!spec) return
    setHeader(Object.fromEntries(HEADER_FIELDS.map(([k]) => [k, spec[k] ?? ''])))
    setItems((spec.items ?? []).map((i: Row) => ({ ...i })))
    setEstNet(spec.estNetWeightKg ?? '')
    try {
      const raw = spec.rawExtract ? JSON.parse(spec.rawExtract) : null
      setFlags(raw?.flags ?? [])
      setMock(!!raw?._mock)
    } catch {
      setFlags([])
    }
  }, [spec?.id])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['spec', versionId] })
    qc.invalidateQueries({ queryKey: ['rfq-version', versionId] })
    onChanged()
  }

  const uploadAndAnalyze = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      await apiClient.post(`/rfq-versions/${versionId}/attachments`, fd)
      return apiClient
        .post(`/rfq-versions/${versionId}/analyze-spec`, {})
        .then((r) => r.data)
    },
    onSuccess: (data: any) => {
      toast.success(data.mock ? 'Analyzed (mock — no API key)' : 'Drawing analyzed')
      qc.invalidateQueries({ queryKey: ['spec-attachments', versionId] })
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const reanalyze = useMutation({
    mutationFn: () => apiClient.post(`/rfq-versions/${versionId}/analyze-spec`, {}).then((r) => r.data),
    onSuccess: (data: any) => {
      toast.success(data.mock ? 'Re-analyzed (mock)' : 'Re-analyzed')
      invalidate()
    },
    onError: (e: any) => {
      if (e?.response?.data?.needsUpload) {
        toast.info('No drawing on file for this revision — pick one to analyze')
        fileRef.current?.click()
      } else {
        toast.error(apiError(e))
      }
    },
  })

  const save = useMutation({
    mutationFn: (reviewed: boolean) =>
      apiClient
        .put(`/rfq-versions/${versionId}/spec`, {
          header,
          estNetWeightKg: estNet === '' ? null : Number(estNet),
          reviewed,
          items: items.map((i) => ({
            id: i.id ? String(i.id) : undefined,
            itemType: i.itemType,
            label: i.label || null,
            nominalValue: i.nominalValue === '' || i.nominalValue == null ? null : Number(i.nominalValue),
            unit: i.unit || null,
            tolUpper: i.tolUpper === '' || i.tolUpper == null ? null : Number(i.tolUpper),
            tolLower: i.tolLower === '' || i.tolLower == null ? null : Number(i.tolLower),
            tolClass: i.tolClass || null,
            datum: i.datum || null,
            gdtType: i.gdtType || null,
            rawText: i.rawText || null,
            confidence: i.confidence ?? null,
            reviewed: i.reviewed ?? true,
            remove: i.remove || undefined,
          })),
        })
        .then((r) => r.data),
    onSuccess: () => {
      toast.success('Spec saved')
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const apply = useMutation({
    mutationFn: () => apiClient.post(`/rfq-versions/${versionId}/spec/apply`, {}).then((r) => r.data),
    onSuccess: (d: any) => {
      toast.success(`Applied: ${d.applied.join(', ') || 'nothing to apply'}`)
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const grouped = useMemo(() => {
    const g: Record<string, { row: Row; idx: number }[]> = {}
    items.forEach((row, idx) => {
      if (row.remove) return
      ;(g[row.itemType] ??= []).push({ row, idx })
    })
    return g
  }, [items])

  const setItem = (idx: number, patch: Row) =>
    setItems((arr) => arr.map((x, j) => (j === idx ? { ...x, ...patch } : x)))

  if (specQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading spec analysis…</p>

  // ---- No spec yet: upload + analyze ------------------------------------
  if (!spec) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Spec Analysis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Upload the customer drawing (PDF or image). It is read into structured data and saved
            against the part number for this revision.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) uploadAndAnalyze.mutate(f)
              e.target.value = ''
            }}
          />
          {canEdit && (
            <Button onClick={() => fileRef.current?.click()} disabled={uploadAndAnalyze.isPending}>
              <Upload className="h-4 w-4 mr-1" />
              {uploadAndAnalyze.isPending ? 'Analyzing…' : 'Upload & analyze drawing'}
            </Button>
          )}
          <AttachmentList
            versionId={versionId}
            attachments={attachments}
            canEdit={canEdit}
            onChanged={() => qc.invalidateQueries({ queryKey: ['spec-attachments', versionId] })}
          />
        </CardContent>
      </Card>
    )
  }

  // ---- Spec exists: review grid --------------------------------------
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          Spec Analysis
          {spec.reviewed ? (
            <Badge variant="success">Reviewed</Badge>
          ) : (
            <Badge variant="warning">Needs review</Badge>
          )}
          {mock && <Badge variant="secondary">mock</Badge>}
          {spec.overallConfidence != null && (
            <span className="text-xs font-normal text-muted-foreground">
              conf {Number(spec.overallConfidence).toFixed(2)}
            </span>
          )}
        </CardTitle>
        {canEdit && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => reanalyze.mutate()} disabled={reanalyze.isPending}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Re-analyze
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) uploadAndAnalyze.mutate(f)
            e.target.value = ''
          }}
        />
        {flags.length > 0 && (
          <ul className="text-xs text-amber-700 bg-amber-50 rounded-md p-3 space-y-1">
            {flags.map((f, i) => (
              <li key={i}>⚑ {f}</li>
            ))}
          </ul>
        )}

        <AttachmentList
          versionId={versionId}
          attachments={attachments}
          analyzedId={spec.attachment?.id ? String(spec.attachment.id) : spec.attachmentId ? String(spec.attachmentId) : undefined}
          canEdit={canEdit}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['spec-attachments', versionId] })
            invalidate()
          }}
          onUpload={canEdit ? (file) => uploadAndAnalyze.mutate(file) : undefined}
          uploading={uploadAndAnalyze.isPending}
        />

        {/* Header fields */}
        <div className="grid gap-3 md:grid-cols-3">
          {HEADER_FIELDS.map(([k, label]) => (
            <div key={k} className="grid gap-1.5">
              <Label>{label}</Label>
              <Input
                disabled={!canEdit}
                value={header[k] ?? ''}
                onChange={(e) => setHeader((s) => ({ ...s, [k]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        {/* Derived weights */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/40 p-3">
          <div className="grid gap-1.5">
            <Label>Est. net weight (kg)</Label>
            <Input
              className="w-32"
              type="number"
              step="0.001"
              disabled={!canEdit}
              value={estNet}
              onChange={(e) => setEstNet(e.target.value)}
            />
          </div>
          <div className="text-sm text-muted-foreground">
            Est. input weight: <b>{spec.estInputWeightKg ?? '—'} kg</b> (bounding bar stock)
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => apply.mutate()} disabled={apply.isPending}>
              Apply to part attributes
            </Button>
          )}
        </div>

        {/* Items grouped by type */}
        <div className="space-y-4">
          {SPEC_ITEM_TYPES.filter((t) => grouped[t]?.length).map((type) => (
            <div key={type}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-muted-foreground">{type}</span>
                <span className="text-xs text-muted-foreground">({grouped[type].length})</span>
              </div>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {ITEM_COLS.map(([, l]) => (
                        <TableHead key={l}>{l}</TableHead>
                      ))}
                      <TableHead className="w-16">Conf</TableHead>
                      {canEdit && <TableHead className="w-10" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grouped[type].map(({ row, idx }) => (
                      <TableRow key={row.id ?? `new-${idx}`}>
                        {ITEM_COLS.map(([k]) => (
                          <TableCell key={k}>
                            <Input
                              className="min-w-[5rem]"
                              disabled={!canEdit}
                              value={row[k] ?? ''}
                              onChange={(e) => setItem(idx, { [k]: e.target.value })}
                            />
                          </TableCell>
                        ))}
                        <TableCell className="text-xs text-muted-foreground">
                          {row.confidence != null ? Number(row.confidence).toFixed(2) : '—'}
                        </TableCell>
                        {canEdit && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setItem(idx, { remove: true })}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="w-40"
              value=""
              onChange={(e) => {
                if (e.target.value)
                  setItems((a) => [...a, { itemType: e.target.value, reviewed: true }])
              }}
            >
              <option value="">+ Add item…</option>
              {SPEC_ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={() => save.mutate(false)} disabled={save.isPending}>
              <Plus className="h-4 w-4 mr-1" /> Save
            </Button>
            <Button onClick={() => save.mutate(true)} disabled={save.isPending}>
              <Check className="h-4 w-4 mr-1" /> Save &amp; mark reviewed
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AttachmentList({
  versionId,
  attachments,
  analyzedId,
  canEdit,
  onChanged,
  onUpload,
  uploading,
}: {
  versionId: string
  attachments: Row[]
  analyzedId?: string
  canEdit: boolean
  onChanged: () => void
  onUpload?: (file: File) => void
  uploading?: boolean
}) {
  const addRef = useRef<HTMLInputElement>(null)

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/rfq-versions/${versionId}/attachments/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('File removed')
      onChanged()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">
          Drawing / spec files ({attachments.length})
        </span>
        {onUpload && (
          <>
            <input
              ref={addRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onUpload(f)
                e.target.value = ''
              }}
            />
            <Button size="sm" variant="outline" onClick={() => addRef.current?.click()} disabled={uploading}>
              <Upload className="h-3.5 w-3.5 mr-1" /> {uploading ? 'Analyzing…' : 'Upload & re-analyze'}
            </Button>
          </>
        )}
      </div>

      {attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No files uploaded for this revision yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">{a.fileName}</span>
              {analyzedId && String(a.id) === analyzedId && (
                <Badge variant="secondary">analyzed</Badge>
              )}
              <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                {a.uploadedAt ? String(a.uploadedAt).slice(0, 10) : ''}
              </span>
              <Button
                variant="ghost"
                size="icon"
                title="Download"
                onClick={() =>
                  downloadFile(
                    `/rfq-versions/${versionId}/attachments/${a.id}/download`,
                    a.fileName
                  ).catch((e) => toast.error(apiError(e)))
                }
              >
                <Download className="h-4 w-4" />
              </Button>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  title="Remove"
                  onClick={() => {
                    if (confirm(`Remove "${a.fileName}"?`)) remove.mutate(String(a.id))
                  }}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
