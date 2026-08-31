import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, Link } from 'react-router-dom'
import { Upload, ArrowLeft, ArrowRight, Check, FileText, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, apiError, downloadFile } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Preview = any

const money = (n: any) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export default function CreateRfqWizard() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)

  const [f, setF] = useState({
    partNumber: '',
    partName: '',
    revision: 'R00',
    customerId: '',
    newCustomerName: '',
    createCustomer: false,
    productTypeId: '',
    sourcingType: 'MANUFACTURED',
    purchasePricePerPc: '',
    supplierName: '',
    materialCategoryId: '',
    materialShapeId: '',
    forgingLossPct: '12',
    annualQty: '',
    batchQty: '',
    requiredDate: '',
    currency: 'INR',
    versionLabel: '',
    confirmRevision: false,
  })
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }))

  const customers = useQuery({ queryKey: ['options', '/customers'], queryFn: () => apiClient.get('/customers').then((r) => r.data) })
  const grades = useQuery({ queryKey: ['options', '/material/categories'], queryFn: () => apiClient.get('/material/categories').then((r) => r.data) })
  const shapes = useQuery({ queryKey: ['options', '/material/shapes'], queryFn: () => apiClient.get('/material/shapes').then((r) => r.data) })
  const productTypes = useQuery({ queryKey: ['options', '/product-types'], queryFn: () => apiClient.get('/product-types').then((r) => r.data) })

  async function analyze(picked: File) {
    setBusy(true)
    setFile(picked)
    try {
      const fd = new FormData()
      fd.append('file', picked)
      const p = await apiClient.post('/rfqs/spec-preview', fd).then((r) => r.data)
      setPreview(p)
      set({
        partNumber: p.partNumber ?? '',
        partName: p.partName ?? '',
        revision: p.revision ?? 'R00',
        customerId: p.customerMatch?.id ?? '',
        createCustomer: !p.customerMatch && !!p.suggestedCustomerName,
        newCustomerName: p.customerMatch ? '' : (p.suggestedCustomerName ?? ''),
        materialCategoryId: p.gradeMatch?.id ?? '',
        materialShapeId: p.suggestedShape?.id ?? '',
        confirmRevision: false,
      })
      setStep(2)
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!file || !preview) return
    if (preview.existing && !f.confirmRevision) {
      toast.error('Confirm the new revision to continue')
      return
    }
    setBusy(true)
    try {
      const payload = {
        extract: preview.extract,
        mock: preview.mock,
        partNumber: f.partNumber,
        partName: f.partName,
        revision: f.revision,
        customerId: f.createCustomer ? undefined : f.customerId || undefined,
        newCustomerName: f.createCustomer ? f.newCustomerName : undefined,
        productTypeId: f.productTypeId || undefined,
        sourcingType: f.sourcingType,
        purchasePricePerPc:
          f.sourcingType === 'BOUGHT_OUT' && f.purchasePricePerPc ? Number(f.purchasePricePerPc) : undefined,
        supplierName: f.sourcingType === 'BOUGHT_OUT' ? f.supplierName || undefined : undefined,
        materialCategoryId: f.sourcingType === 'BOUGHT_OUT' ? undefined : f.materialCategoryId || undefined,
        materialShapeId: f.sourcingType === 'BOUGHT_OUT' ? undefined : f.materialShapeId || undefined,
        forgingLossPct: Number(f.forgingLossPct || 12),
        annualQty: f.annualQty || undefined,
        batchQty: f.batchQty || undefined,
        requiredDate: f.requiredDate || undefined,
        currency: f.currency,
        versionLabel: f.versionLabel || undefined,
        confirmRevision: f.confirmRevision,
        autoLines: true,
      }
      const fd = new FormData()
      fd.append('file', file)
      fd.append('payload', JSON.stringify(payload))
      const res = await apiClient.post('/rfqs/from-spec', fd).then((r) => r.data)
      setResult(res)
      setStep(4)
      toast.success(res.isNewRevision ? `Revision R${res.revisionNo} created` : `RFQ ${res.rfqNumber} created`)
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const itemCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const it of preview?.items ?? []) c[it.itemType] = (c[it.itemType] ?? 0) + 1
    return c
  }, [preview])

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-2">
        <Link to="/rfqs" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="h-4 w-4" /> RFQs
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold">New RFQ from spec</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload the customer drawing — the part number, customer and specs are read from it,
          a draft cost sheet is built, then you add quantities and generate the quotation.
        </p>
      </div>

      <ol className="flex gap-2 text-xs">
        {['Upload', 'Review', 'Quantities', 'Done'].map((label, i) => (
          <li
            key={label}
            className={`flex-1 rounded-md border px-3 py-2 ${
              step === i + 1 ? 'border-primary bg-primary/5 font-medium text-primary' : 'text-muted-foreground'
            }`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {/* STEP 1 — upload */}
      {step === 1 && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0]
                if (picked) analyze(picked)
                e.target.value = ''
              }}
            />
            <FileText className="h-10 w-10 mx-auto text-slate-300" />
            <Button onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload className="h-4 w-4 mr-1" />
              {busy ? 'Analyzing…' : 'Upload spec drawing'}
            </Button>
            <p className="text-xs text-muted-foreground">
              PDF or image. Tip: name the file with the customer part number.
            </p>
            <p className="text-xs text-muted-foreground">
              or{' '}
              <Link to="/rfqs" className="text-primary hover:underline">
                create an RFQ manually
              </Link>{' '}
              from the RFQ list.
            </p>
          </CardContent>
        </Card>
      )}

      {/* STEP 2 — review */}
      {step === 2 && preview && (
        <div className="space-y-4">
          {preview.mock && (
            <div className="text-xs text-muted-foreground bg-muted rounded-md p-3">
              <Badge variant="secondary">mock extraction</Badge> No <code>ANTHROPIC_API_KEY</code>{' '}
              configured — values below are illustrative. Set a key in <code>apps/api/.env</code> for
              real extraction.
            </div>
          )}

          {preview.existing && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm space-y-2">
              <div className="flex items-center gap-2 font-medium text-amber-800">
                <AlertTriangle className="h-4 w-4" /> This part was quoted before
              </div>
              <p className="text-amber-700">
                <b>{preview.partNumber}</b> already has RFQ <b>{preview.existing.rfqNumber}</b> (latest
                R{preview.existing.latestRevisionNo}). A new revision R
                {preview.existing.latestRevisionNo + 1} will be added to that RFQ.
              </p>
              <label className="flex items-center gap-2 text-amber-800">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={f.confirmRevision}
                  onChange={(e) => set({ confirmRevision: e.target.checked })}
                />
                Yes, create a new revision
              </label>
            </div>
          )}

          {preview.flags?.length > 0 && (
            <ul className="text-xs text-amber-700 bg-amber-50 rounded-md p-3 space-y-1">
              {preview.flags.map((fl: string, i: number) => (
                <li key={i}>⚑ {fl}</li>
              ))}
            </ul>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Part &amp; customer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <Field label="Customer part number" required>
                <Input value={f.partNumber} onChange={(e) => set({ partNumber: e.target.value })} />
              </Field>
              <Field label="Part name" required>
                <Input value={f.partName} onChange={(e) => set({ partName: e.target.value })} />
              </Field>
              <Field label="Drawing revision">
                <Input value={f.revision} onChange={(e) => set({ revision: e.target.value })} />
              </Field>
              <Field label="Product type">
                <Select value={f.productTypeId} onChange={(e) => set({ productTypeId: e.target.value })}>
                  <option value="">
                    {preview.productType ? `(spec: ${preview.productType})` : '—'}
                  </option>
                  {(productTypes.data ?? []).map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="md:col-span-2 grid gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={f.createCustomer}
                    onChange={(e) => set({ createCustomer: e.target.checked })}
                  />
                  Customer not in the list — create it
                  {preview.suggestedCustomerName && (
                    <span className="text-muted-foreground"> (spec: {preview.suggestedCustomerName})</span>
                  )}
                </label>
                {f.createCustomer ? (
                  <Input
                    placeholder="New customer name"
                    value={f.newCustomerName}
                    onChange={(e) => set({ newCustomerName: e.target.value })}
                  />
                ) : (
                  <Select value={f.customerId} onChange={(e) => set({ customerId: e.target.value })}>
                    <option value="">Select customer…</option>
                    {(customers.data ?? []).map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name} (rating {c.rating})
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Sourcing</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <Field label="This part is">
                <Select
                  value={f.sourcingType}
                  onChange={(e) => set({ sourcingType: e.target.value })}
                >
                  <option value="MANUFACTURED">Manufactured in-house</option>
                  <option value="BOUGHT_OUT">Bought-out / procured (assembly)</option>
                </Select>
              </Field>
              <div className="hidden md:block" />

              {f.sourcingType === 'BOUGHT_OUT' ? (
                <>
                  <Field label="Purchase price / pc">
                    <Input
                      type="number"
                      step="0.01"
                      value={f.purchasePricePerPc}
                      onChange={(e) => set({ purchasePricePerPc: e.target.value })}
                    />
                  </Field>
                  <Field label="Supplier">
                    <Input
                      value={f.supplierName}
                      onChange={(e) => set({ supplierName: e.target.value })}
                    />
                  </Field>
                  <p className="md:col-span-2 text-xs text-muted-foreground">
                    Bought-out: the purchase price replaces the material + machining build-up.
                    Handling, QC, admin and margin still apply. You can add assembly / incoming-
                    inspection lines on the cost sheet.
                  </p>
                </>
              ) : (
                <>
                  <Field
                    label={`Material grade${preview.materialNote ? ` (spec: ${preview.materialNote})` : ''}`}
                  >
                    <Select
                      value={f.materialCategoryId}
                      onChange={(e) => set({ materialCategoryId: e.target.value })}
                    >
                      <option value="">— pick a grade —</option>
                      {(grades.data ?? []).map((g: any) => (
                        <option key={g.id} value={g.id}>
                          {g.gradeCode} {g.materialType ? `(${g.materialType.name})` : ''}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Stock shape">
                    <Select
                      value={f.materialShapeId}
                      onChange={(e) => set({ materialShapeId: e.target.value })}
                    >
                      <option value="">—</option>
                      {(shapes.data ?? []).map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Forging loss %">
                    <Input
                      type="number"
                      value={f.forgingLossPct}
                      onChange={(e) => set({ forgingLossPct: e.target.value })}
                    />
                  </Field>
                  <div className="text-sm text-muted-foreground self-end">
                    Est. net {preview.weights?.estNetWeightKg ?? '—'} kg · input{' '}
                    {preview.weights?.estInputWeightKg ?? '—'} kg
                    <div className="text-xs text-muted-foreground">{preview.weights?.basis}</div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Extracted callouts ({preview.items?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {Object.entries(itemCounts).map(([t, n]) => (
                <Badge key={t} variant="outline">
                  {t} × {n}
                </Badge>
              ))}
              <span className="text-xs text-muted-foreground w-full">
                Full detail is reviewable on the RFQ's Spec Analysis panel after creation.
              </span>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button
              onClick={() => setStep(3)}
              disabled={!f.partNumber || !f.partName || (preview.existing && !f.confirmRevision)}
            >
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3 — quantities */}
      {step === 3 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quantities &amp; RFQ details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Field label="Annual quantity">
              <Input type="number" value={f.annualQty} onChange={(e) => set({ annualQty: e.target.value })} />
            </Field>
            <Field label="Batch quantity">
              <Input type="number" value={f.batchQty} onChange={(e) => set({ batchQty: e.target.value })} />
            </Field>
            <Field label="Required date">
              <Input type="date" value={f.requiredDate} onChange={(e) => set({ requiredDate: e.target.value })} />
            </Field>
            <Field label="Currency">
              <Input value={f.currency} onChange={(e) => set({ currency: e.target.value })} />
            </Field>
            <Field label="Revision label (optional)">
              <Input value={f.versionLabel} onChange={(e) => set({ versionLabel: e.target.value })} />
            </Field>
            <div className="md:col-span-2 flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={submit} disabled={busy}>
                <Check className="h-4 w-4 mr-1" />
                {busy ? 'Creating…' : preview?.existing ? 'Create revision' : 'Create RFQ'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 4 — done */}
      {step === 4 && result && (
        <Card>
          <CardContent className="py-8 space-y-4">
            <div className="text-center space-y-1">
              <Check className="h-9 w-9 mx-auto text-green-500" />
              <div className="text-lg font-semibold">
                {result.isNewRevision ? 'Revision' : 'RFQ'} created — {result.rfqNumber} · R
                {result.revisionNo}
              </div>
              {result.createdCustomer && (
                <p className="text-xs text-muted-foreground">A new customer record was created (rating 3).</p>
              )}
            </div>

            {result.costSummary && (
              <div className="rounded-md border p-4 text-sm max-w-sm mx-auto">
                <div className="flex justify-between">
                  <span>Quoted price / pc</span>
                  <b>{money(result.costSummary.quotedPricePerPc)}</b>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Total quote</span>
                  <span>{money(result.costSummary.totalQuote)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Margin</span>
                  <span>{result.costSummary.marginPct}%</span>
                </div>
              </div>
            )}

            {result.flags?.length > 0 && (
              <ul className="text-xs text-amber-700 bg-amber-50 rounded-md p-3 space-y-1 max-w-lg mx-auto">
                {result.flags.map((fl: string, i: number) => (
                  <li key={i}>⚑ {fl}</li>
                ))}
              </ul>
            )}

            <div className="flex justify-center gap-2">
              <Button onClick={() => navigate(`/rfqs/${result.rfqId}`)}>Open RFQ</Button>
              <Button
                variant="outline"
                disabled={!result.costSummary}
                onClick={async () => {
                  try {
                    await apiClient.post(`/rfq-versions/${result.versionId}/quote`, {})
                    await downloadFile(
                      `/rfq-versions/${result.versionId}/quotation.pdf`,
                      `quotation-${result.rfqNumber.replace(/\//g, '-')}-R${result.revisionNo}.pdf`
                    )
                    toast.success('Quotation generated')
                  } catch (e) {
                    toast.error(apiError(e))
                  }
                }}
              >
                Generate quotation
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </Label>
      {children}
    </div>
  )
}
