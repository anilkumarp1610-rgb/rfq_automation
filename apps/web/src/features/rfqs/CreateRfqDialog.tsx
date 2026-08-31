import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { resource, apiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

const partsApi = resource('/customer-parts')
const rfqApi = resource('/rfqs')

export default function CreateRfqDialog() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    rfqNumber: '',
    customerPartId: '',
    requiredDate: '',
    annualQty: '',
    batchQty: '',
    versionLabel: '',
  })

  const partsQuery = useQuery({
    queryKey: ['options', '/customer-parts'],
    queryFn: () => partsApi.list(),
    enabled: open,
  })

  const create = useMutation({
    mutationFn: () =>
      rfqApi.create({
        rfqNumber: form.rfqNumber,
        customerPartId: form.customerPartId,
        requiredDate: form.requiredDate || undefined,
        annualQty: form.annualQty || undefined,
        batchQty: form.batchQty || undefined,
        versionLabel: form.versionLabel || undefined,
      }),
    onSuccess: (rfq: any) => {
      toast.success('RFQ created')
      qc.invalidateQueries({ queryKey: ['rfqs'] })
      setOpen(false)
      navigate(`/rfqs/${rfq.id}`)
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const parts = (partsQuery.data as any[]) ?? []

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>+ New RFQ</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New RFQ</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="customerPartId">
              Customer part <span className="text-red-500">*</span>
            </Label>
            <Select
              id="customerPartId"
              required
              value={form.customerPartId}
              onChange={(e) => setForm((s) => ({ ...s, customerPartId: e.target.value }))}
            >
              <option value="">Select…</option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.customer?.code} · {p.customerPartNumber} — {p.partName}
                </option>
              ))}
            </Select>
            {parts.length === 0 && !partsQuery.isLoading && (
              <p className="text-xs text-amber-600">
                No customer parts yet — create one under Customer Parts first.
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="rfqNumber">
              RFQ number <span className="text-red-500">*</span>
            </Label>
            <Input
              id="rfqNumber"
              required
              value={form.rfqNumber}
              onChange={(e) => setForm((s) => ({ ...s, rfqNumber: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="annualQty">Annual qty</Label>
              <Input
                id="annualQty"
                type="number"
                value={form.annualQty}
                onChange={(e) => setForm((s) => ({ ...s, annualQty: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="batchQty">Batch qty</Label>
              <Input
                id="batchQty"
                type="number"
                value={form.batchQty}
                onChange={(e) => setForm((s) => ({ ...s, batchQty: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="requiredDate">Required date</Label>
              <Input
                id="requiredDate"
                type="date"
                value={form.requiredDate}
                onChange={(e) => setForm((s) => ({ ...s, requiredDate: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="versionLabel">Rev 1 label</Label>
              <Input
                id="versionLabel"
                value={form.versionLabel}
                onChange={(e) => setForm((s) => ({ ...s, versionLabel: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
