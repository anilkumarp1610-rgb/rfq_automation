import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, FileText, FlaskConical, Play, Trash2, Upload, X } from 'lucide-react'
import { apiClient, apiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import DataGrid, { type GridColumn } from '@/components/DataGrid'

/**
 * Internal test folder. Upload drawings, run the extraction on each one and compare what it
 * read. Nothing here creates customers, parts or RFQs.
 */

type Mode = 'live' | 'text' | 'sample' | 'unavailable'
type Source = 'ai' | 'text' | 'sample'

interface Summary {
  analyzedAt: string
  mock: boolean
  source: Source
  model: string | null
  usage: { inputTokens: number; outputTokens: number } | null
  seconds: number
  drawingNo: string | null
  itemName: string | null
  materialGrade: string | null
  materialNote: string | null
  gradeMatch: { gradeCode: string; materialType: string } | null
  units: string | null
  productType: string | null
  customerName: string | null
  revision: string | null
  maxOdMm: number | string | null
  overallLengthMm: number | string | null
  itemCount: number
  flagCount: number
}
interface FileRow {
  name: string
  size: number
  uploadedAt: string
  mime: string
  analysis: Summary | null
}
interface Detail extends Omit<Summary, 'drawingNo'> {
  name: string
  header: Record<string, unknown>
  items: Record<string, unknown>[]
  flags: string[]
  weights: Record<string, unknown> | null
  gradeText: string | null
  filenamePart: string | null
}

// Real extraction can take a minute; the app-wide 15 s limit would cut it off.
const SLOW = { timeout: 300_000 }

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const num = (v: unknown) => (v == null || v === '' ? '—' : String(Number(Number(v).toFixed(2))))
const dash = (v: unknown) => (v == null || v === '' ? '—' : String(v))

const banner: Record<Mode, { cls: string; icon: JSX.Element; text: JSX.Element }> = {
  live: {
    cls: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    icon: <CheckCircle2 className="h-4 w-4" />,
    text: (
      <>
        <b>Live AI extraction.</b> Each “Analyze” sends the drawing to the model and is a paid call.
      </>
    ),
  },
  text: {
    cls: 'border-sky-300 bg-sky-50 text-sky-900',
    icon: <FileText className="h-4 w-4" />,
    text: (
      <>
        <b>Free text reading (no AI).</b> Values are read from the PDF’s own text — drawing no., item name, material grade,
        units and the “Ø × length” size in the title. Dimensions and tolerances are not read, and scanned drawings (no
        selectable text) cannot be read. Add Anthropic credit and a key in <code>apps/api/.env</code> for the full AI reading.
      </>
    ),
  },
  sample: {
    cls: 'border-amber-300 bg-amber-50 text-amber-900',
    icon: <AlertTriangle className="h-4 w-4" />,
    text: (
      <>
        <b>Sample mode — values are NOT read from your files.</b> Every drawing returns the same canned shaft.
        Set a real <code>ANTHROPIC_API_KEY</code> in <code>apps/api/.env</code>, remove <code>SPEC_ALLOW_MOCK</code>{' '}
        and restart the API.
      </>
    ),
  },
  unavailable: {
    cls: 'border-red-300 bg-red-50 text-red-800',
    icon: <AlertTriangle className="h-4 w-4" />,
    text: (
      <>
        <b>AI extraction is not configured.</b> Set a real <code>ANTHROPIC_API_KEY</code> (<code>sk-ant-…</code>) in{' '}
        <code>apps/api/.env</code> and restart the API. You can still upload and view files.
      </>
    ),
  },
}

export default function TestDrawingsPage() {
  const qc = useQueryClient()
  const picker = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)
  const [rejected, setRejected] = useState<{ name: string; reason: string }[]>([])

  const list = useQuery({
    queryKey: ['test-drawings'],
    queryFn: () => apiClient.get<{ files: FileRow[]; extraction: Mode }>('/test-drawings').then((r) => r.data),
  })
  const files = list.data?.files ?? []
  const mode: Mode = list.data?.extraction ?? 'unavailable'
  const refresh = () => qc.invalidateQueries({ queryKey: ['test-drawings'] })

  const detail = useQuery({
    queryKey: ['test-drawings', 'detail', selected, files.find((f) => f.name === selected)?.analysis?.analyzedAt],
    enabled: !!selected && !!files.find((f) => f.name === selected)?.analysis,
    queryFn: () =>
      apiClient.get<Detail>(`/test-drawings/${encodeURIComponent(selected!)}/analysis`).then((r) => r.data),
  })

  const upload = useMutation({
    mutationFn: (picked: File[]) => {
      const fd = new FormData()
      picked.forEach((f) => fd.append('files', f))
      return apiClient
        .post<{ saved: string[]; rejected: { name: string; reason: string }[] }>('/test-drawings', fd, SLOW)
        .then((r) => r.data)
    },
    onSuccess: (r) => {
      setRejected(r.rejected)
      toast.success(`${r.saved.length} file${r.saved.length === 1 ? '' : 's'} uploaded`)
      refresh()
    },
    onError: (e: any) => {
      setRejected(e?.response?.data?.rejected ?? [])
      toast.error(apiError(e))
    },
  })

  async function analyze(name: string, quiet = false, textOnly = false) {
    setRunning((s) => new Set(s).add(name))
    try {
      await apiClient.post(
        `/test-drawings/${encodeURIComponent(name)}/analyze${textOnly ? '?mode=text' : ''}`,
        {},
        SLOW
      )
      await refresh()
      if (!quiet) toast.success(`Analyzed ${name}`)
      return true
    } catch (e) {
      toast.error(`${name}: ${apiError(e)}`)
      return false
    } finally {
      setRunning((s) => {
        const n = new Set(s)
        n.delete(name)
        return n
      })
    }
  }

  async function analyzeMany(names: string[], textOnly = false) {
    if (!names.length) return
    const paid = mode === 'live' && !textOnly
    if (
      paid &&
      !confirm(`Analyze ${names.length} drawing${names.length === 1 ? '' : 's'}? Each one is a paid call to the AI model.`)
    )
      return
    setBatch({ done: 0, total: names.length })
    for (let i = 0; i < names.length; i++) {
      const ok = await analyze(names[i], true, textOnly)
      setBatch({ done: i + 1, total: names.length })
      if (!ok && mode !== 'sample' && !(textOnly || mode === 'text')) break // a billing / key problem repeats for every file — stop early
    }
    setBatch(null)
  }

  async function remove(name: string) {
    if (!confirm(`Delete ${name}?`)) return
    try {
      await apiClient.delete(`/test-drawings/${encodeURIComponent(name)}`)
      if (selected === name) setSelected(null)
      toast.success('Deleted')
      refresh()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  async function view(f: FileRow) {
    try {
      const res = await apiClient.get(`/test-drawings/${encodeURIComponent(f.name)}/file`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  // Files that came back with the same drawing no. / name / size — usually means the extraction is not reading them.
  const identical = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const f of files) {
      const a = f.analysis
      if (!a) continue
      const key = [a.drawingNo, a.itemName, a.materialGrade, num(a.maxOdMm), num(a.overallLengthMm)].join('|')
      groups.set(key, [...(groups.get(key) ?? []), f.name])
    }
    return [...groups.values()].filter((g) => g.length > 1)
  }, [files])

  const columns: GridColumn<FileRow>[] = [
    {
      key: 'name',
      header: 'File',
      sortValue: (r) => r.name,
      cell: (r) => (
        <button className="inline-flex items-center gap-1.5 text-left font-medium text-primary hover:underline" onClick={() => setSelected(r.name)}>
          <FileText className="h-3.5 w-3.5 shrink-0" />
          {r.name}
        </button>
      ),
    },
    { key: 'size', header: 'Size', sortValue: (r) => r.size, cell: (r) => kb(r.size) },
    { key: 'drawingNo', header: 'Drawing no.', sortValue: (r) => r.analysis?.drawingNo, cell: (r) => dash(r.analysis?.drawingNo) },
    { key: 'itemName', header: 'Item name', sortValue: (r) => r.analysis?.itemName, cell: (r) => dash(r.analysis?.itemName) },
    {
      key: 'grade',
      header: 'Material / grade',
      sortValue: (r) => r.analysis?.materialGrade ?? r.analysis?.materialNote,
      cell: (r) => {
        const a = r.analysis
        if (!a) return '—'
        const text = a.materialGrade ?? a.materialNote
        return (
          <span>
            {dash(text)}
            {a.gradeMatch && (
              <Badge variant="success" className="ml-1.5">
                → {a.gradeMatch.gradeCode}
              </Badge>
            )}
          </span>
        )
      },
    },
    { key: 'units', header: 'Units', sortValue: (r) => r.analysis?.units, cell: (r) => dash(r.analysis?.units) },
    { key: 'od', header: 'Max Ø mm', align: 'right', sortValue: (r) => Number(r.analysis?.maxOdMm ?? -1), cell: (r) => num(r.analysis?.maxOdMm) },
    { key: 'len', header: 'Length mm', align: 'right', sortValue: (r) => Number(r.analysis?.overallLengthMm ?? -1), cell: (r) => num(r.analysis?.overallLengthMm) },
    { key: 'items', header: 'Items', align: 'right', sortValue: (r) => r.analysis?.itemCount ?? -1, cell: (r) => dash(r.analysis?.itemCount) },
    { key: 'flags', header: 'Flags', align: 'right', sortValue: (r) => r.analysis?.flagCount ?? -1, cell: (r) => dash(r.analysis?.flagCount) },
    {
      key: 'status',
      header: 'Result',
      sortValue: (r) => (r.analysis ? (r.analysis.source === 'sample' ? 1 : r.analysis.source === 'text' ? 2 : 3) : 0),
      cell: (r) =>
        running.has(r.name) ? (
          <Badge variant="secondary">analyzing…</Badge>
        ) : !r.analysis ? (
          <span className="text-muted-foreground">not analyzed</span>
        ) : r.analysis.mock ? (
          <Badge variant="warning">sample data</Badge>
        ) : r.analysis.source === 'text' ? (
          <Badge variant="secondary">read from PDF text</Badge>
        ) : (
          <Badge variant="success">read by AI</Badge>
        ),
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FlaskConical className="h-6 w-6" /> Test Drawings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          An internal folder for trying drawings. Upload PDFs, run the extraction on each and compare what it read — nothing
          here creates a customer, part or RFQ.
        </p>
      </div>

      {list.data && (
        <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${banner[mode].cls}`}>
          <span className="mt-0.5">{banner[mode].icon}</span>
          <div>{banner[mode].text}</div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Upload</CardTitle>
          <CardDescription>PDF or image (PNG, JPG, WEBP, GIF), up to 32 MB each. Pick as many as you like.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={picker}
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            data-testid="test-drawing-input"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? [])
              if (picked.length) upload.mutate(picked)
              e.target.value = ''
            }}
          />
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-sm text-muted-foreground"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const dropped = Array.from(e.dataTransfer.files)
              if (dropped.length) upload.mutate(dropped)
            }}
          >
            <Upload className="h-5 w-5" />
            <span>Drag drawings here, or</span>
            <Button variant="outline" onClick={() => picker.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? 'Uploading…' : 'Choose files'}
            </Button>
          </div>
          {rejected.length > 0 && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              <div className="flex items-center justify-between font-medium">
                Not uploaded
                <button aria-label="Dismiss" onClick={() => setRejected([])}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ul className="list-disc pl-5">
                {rejected.map((r) => (
                  <li key={r.name}>
                    {r.name} — {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {identical.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>Different files returned identical values</b> (drawing no., item name, grade and size):
            <ul className="list-disc pl-5">
              {identical.map((g) => (
                <li key={g.join()}>{g.join(', ')}</li>
              ))}
            </ul>
            If these drawings really differ, the extraction is not reading them.
          </div>
        </div>
      )}

      <DataGrid
        columns={columns}
        rows={files}
        getRowKey={(r) => r.name}
        loading={list.isLoading}
        emptyText="No drawings yet — upload some above."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={!!batch || mode === 'unavailable' || files.every((f) => f.analysis)}
              onClick={() => analyzeMany(files.filter((f) => !f.analysis).map((f) => f.name))}
            >
              <Play className="h-4 w-4 mr-1" /> Analyze new ({files.filter((f) => !f.analysis).length})
            </Button>
            <Button
              variant="outline"
              disabled={!!batch || mode === 'unavailable' || files.length === 0}
              onClick={() => analyzeMany(files.map((f) => f.name))}
            >
              Re-run all
            </Button>
            {mode !== 'text' && mode !== 'unavailable' && (
              <Button
                variant="outline"
                disabled={!!batch || files.every((f) => f.analysis)}
                onClick={() => analyzeMany(files.filter((f) => !f.analysis).map((f) => f.name), true)}
              >
                Read text of new (free)
              </Button>
            )}
            {batch && (
              <span className="text-sm text-muted-foreground">
                Analyzing {batch.done} / {batch.total}…
              </span>
            )}
          </div>
        }
        actionsHeader=""
        actions={(r) => (
          <>
            <Button variant="ghost" size="sm" onClick={() => view(r)}>
              View
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={mode === 'unavailable' || running.has(r.name) || !!batch}
              onClick={() => analyze(r.name)}
            >
              {r.analysis ? 'Re-run' : 'Analyze'}
            </Button>
            {mode !== 'text' && r.mime === 'application/pdf' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={running.has(r.name) || !!batch}
                title="Read the PDF's own text — free, no AI call"
                onClick={() => analyze(r.name, false, true)}
              >
                Read text
              </Button>
            )}
            <Button variant="ghost" size="icon" aria-label={`Delete ${r.name}`} onClick={() => remove(r.name)}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </>
        )}
      />

      {selected && (
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">{selected}</CardTitle>
              <CardDescription>
                {detail.data
                  ? detail.data.mock
                    ? 'Sample data — not read from this file'
                    : detail.data.source === 'text'
                    ? `Read from the PDF's own text (no AI) in ${detail.data.seconds}s`
                    : `Read by ${detail.data.model ?? 'the model'} in ${detail.data.seconds}s` +
                      (detail.data.usage
                        ? ` · ${detail.data.usage.inputTokens.toLocaleString()} in / ${detail.data.usage.outputTokens.toLocaleString()} out tokens`
                        : '')
                  : 'Not analyzed yet'}
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" aria-label="Close details" onClick={() => setSelected(null)}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!files.find((f) => f.name === selected)?.analysis && (
              <p className="text-muted-foreground">Run “Analyze” on this file to see what was read.</p>
            )}
            {detail.data && <DetailView d={detail.data} />}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function DetailView({ d }: { d: Detail }) {
  const h = d.header
  const fields: [string, unknown][] = [
    ['Drawing no.', h.drawingNo],
    ['Item name', h.itemName],
    ['Title', h.title],
    ['Customer', h.customerName],
    ['Revision', h.revision],
    ['Material grade', h.materialGrade],
    ['Material note', h.materialNote],
    ['Matches master grade', d.gradeMatch ? `${d.gradeMatch.gradeCode} (${d.gradeMatch.materialType})` : null],
    ['Product type', h.productType],
    ['Units on drawing', h.units],
    ['Max Ø (mm)', h.maxOdMm],
    ['Overall length (mm)', h.overallLengthMm],
    ['Across flats (mm)', h.acrossFlatsMm],
    ['Sheet / scale', [h.sheetSize, h.scale].filter(Boolean).join(' · ') || null],
    ['Part no. from file name', d.filenamePart],
    ['Est. net weight (kg)', d.weights?.estNetWeightKg],
    ['Est. bar weight (kg)', d.weights?.estInputWeightKg],
  ]
  return (
    <>
      <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-40 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="font-medium break-words">{dash(v)}</dd>
          </div>
        ))}
      </dl>
      {h.notes ? (
        <p>
          <span className="text-muted-foreground">Notes: </span>
          {String(h.notes)}
        </p>
      ) : null}
      {d.flags.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <div className="font-medium">Flags to resolve</div>
          <ul className="list-disc pl-5">
            {d.flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <div className="mb-1 font-medium">Items read ({d.items.length})</div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted text-left">
              <tr>
                {['Type', 'Label', 'Nominal', 'Tol +', 'Tol −', 'Fit', 'Datum', 'As printed', 'Conf.'].map((c) => (
                  <th key={c} className="px-2 py-1.5">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.items.map((it, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1">{dash(it.itemType)}</td>
                  <td className="px-2 py-1">{dash(it.label)}</td>
                  <td className="px-2 py-1">{dash(it.nominalValue)}</td>
                  <td className="px-2 py-1">{dash(it.tolUpper)}</td>
                  <td className="px-2 py-1">{dash(it.tolLower)}</td>
                  <td className="px-2 py-1">{dash(it.tolClass)}</td>
                  <td className="px-2 py-1">{dash(it.datum)}</td>
                  <td className="px-2 py-1">{dash(it.rawText)}</td>
                  <td className="px-2 py-1">{it.confidence == null ? '—' : Number(it.confidence).toFixed(2)}</td>
                </tr>
              ))}
              {d.items.length === 0 && (
                <tr>
                  <td className="px-2 py-2 text-muted-foreground" colSpan={9}>
                    Nothing read.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
