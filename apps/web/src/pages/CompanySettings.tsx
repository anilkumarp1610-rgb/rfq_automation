import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { Upload, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, apiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/field'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const empty = {
  name: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  gstNo: '',
  footerNote: '',
  logo: '' as string | null,
}

export default function CompanySettingsPage() {
  const { isAdminOrManager } = useAuth()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [f, setF] = useState(empty)
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }))

  const { data, isLoading } = useQuery({
    queryKey: ['company'],
    queryFn: () => apiClient.get('/company').then((r) => r.data),
  })

  useEffect(() => {
    if (data) {
      setF({
        name: data.name ?? '',
        address: data.address ?? '',
        phone: data.phone ?? '',
        email: data.email ?? '',
        website: data.website ?? '',
        gstNo: data.gstNo ?? '',
        footerNote: data.footerNote ?? '',
        logo: data.logo ?? null,
      })
    }
  }, [data])

  const save = useMutation({
    mutationFn: () =>
      apiClient
        .put('/company', {
          name: f.name,
          address: f.address || undefined,
          phone: f.phone || undefined,
          email: f.email || undefined,
          website: f.website || undefined,
          gstNo: f.gstNo || undefined,
          footerNote: f.footerNote || undefined,
          logo: f.logo || null,
        })
        .then((r) => r.data),
    onSuccess: () => {
      toast.success('Company details saved')
      qc.invalidateQueries({ queryKey: ['company'] })
      qc.invalidateQueries({ queryKey: ['company-name'] })
    },
    onError: (e) => toast.error(apiError(e)),
  })

  function onLogo(file: File) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      toast.error('Logo must be a PNG or JPEG')
      return
    }
    if (file.size > 1_000_000) {
      toast.error('Logo must be under 1 MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => set({ logo: String(reader.result) })
    reader.readAsDataURL(file)
  }

  if (!isAdminOrManager) return <Navigate to="/" replace />

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Company / Firm details</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The single company profile — shown on the quotation &amp; cost-sheet PDFs and in the
          app header. Editing here updates that one record.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1.5 md:col-span-2">
            <Label>
              Company name <span className="text-red-500">*</span>
            </Label>
            <Input value={f.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="grid gap-1.5 md:col-span-2">
            <Label>Address</Label>
            <Textarea value={f.address} onChange={(e) => set({ address: e.target.value })} />
          </div>
          <Field label="Phone" v={f.phone} onChange={(v) => set({ phone: v })} />
          <Field label="Email" v={f.email} onChange={(v) => set({ email: v })} />
          <Field label="Website" v={f.website} onChange={(v) => set({ website: v })} />
          <Field label="GSTIN" v={f.gstNo} onChange={(v) => set({ gstNo: v })} />
          <div className="grid gap-1.5 md:col-span-2">
            <Label>Quotation footer note</Label>
            <Textarea
              value={f.footerNote}
              onChange={(e) => set({ footerNote: e.target.value })}
              placeholder="e.g. bank details, terms, disclaimer"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Logo</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onLogo(file)
              e.target.value = ''
            }}
          />
          {f.logo ? (
            <img
              src={f.logo}
              alt="logo"
              className="h-16 max-w-[180px] object-contain rounded border bg-card p-1"
            />
          ) : (
            <div className="h-16 w-[180px] grid place-items-center rounded border text-xs text-muted-foreground">
              No logo
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1" /> Upload
            </Button>
            {f.logo && (
              <Button variant="ghost" size="sm" onClick={() => set({ logo: null })}>
                <Trash2 className="h-4 w-4 mr-1 text-red-500" /> Remove
              </Button>
            )}
          </div>
          <span className="text-xs text-muted-foreground">PNG or JPEG, under 1 MB.</span>
        </CardContent>
      </Card>

      <Button onClick={() => save.mutate()} disabled={save.isPending || isLoading || !f.name}>
        {save.isPending ? 'Saving…' : 'Save company details'}
      </Button>
    </div>
  )
}

function Field({
  label,
  v,
  onChange,
}: {
  label: string
  v: string
  onChange: (v: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input value={v} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
