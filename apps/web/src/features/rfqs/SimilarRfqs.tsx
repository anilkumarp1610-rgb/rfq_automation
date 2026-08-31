import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient, apiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import DataGrid, { type GridColumn } from '@/components/DataGrid'
import { StatusBadge } from './StatusBadge'

const money = (n: any) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const dims = (d: any) =>
  !d
    ? '—'
    : [
        d.maxOdMm ? `Ø${d.maxOdMm}` : null,
        d.overallLengthMm ? `L${d.overallLengthMm}` : null,
        d.netWeightKg ? `${d.netWeightKg}kg` : null,
      ]
        .filter(Boolean)
        .join(' · ') || '—'

export default function SimilarRfqs({
  versionId,
  reference,
  canEdit,
  onChanged,
}: {
  versionId: string
  reference: any
  canEdit: boolean
  onChanged: () => void
}) {
  const qc = useQueryClient()
  const [actual, setActual] = useState('')
  useEffect(() => setActual(reference?.actualCost ?? ''), [reference?.actualCost])

  const { data, isLoading } = useQuery({
    queryKey: ['similar', versionId],
    queryFn: () =>
      apiClient.get(`/reference/similar?versionId=${versionId}&limit=8`).then((r) => r.data),
  })

  const saveRef = useMutation({
    mutationFn: (body: any) =>
      apiClient.post(`/rfq-versions/${versionId}/reference`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('Reference updated')
      qc.invalidateQueries({ queryKey: ['similar'] })
      onChanged()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const matches = (data?.matches as any[]) ?? []
  const maxScore = matches.length ? matches[0].score : 1

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Reference &amp; similar RFQs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* This estimate's reference row */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/40 p-3">
          {reference ? (
            <>
              <div className="text-sm">
                This estimate: <StatusBadge status={reference.outcome} /> ·{' '}
                {money(reference.quotedPricePerPc)}/pc
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs text-muted-foreground">Actual cost / pc</label>
                <Input
                  className="w-32"
                  type="number"
                  step="0.01"
                  disabled={!canEdit}
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                />
              </div>
              {canEdit && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      saveRef.mutate({ actualCost: actual === '' ? null : Number(actual) })
                    }
                  >
                    Save actual
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => saveRef.mutate({ outcome: 'WON' })}>
                    Mark won
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => saveRef.mutate({ outcome: 'LOST' })}>
                    Mark lost
                  </Button>
                </>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Compute the cost and set this revision to <b>QUOTED</b> (or Won/Lost) to record it in
              the reference history.
            </p>
          )}
        </div>

        {/* Similar matches */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Finding comparable RFQs…</p>
        ) : matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No comparable historical RFQs yet — they appear here as more parts are quoted.
          </p>
        ) : (
          <DataGrid
            columns={similarColumns(maxScore)}
            rows={matches}
            getRowKey={(m: any) => String(m.referenceId)}
            pageSize={10}
          />
        )}
      </CardContent>
    </Card>
  )
}

function similarColumns(maxScore: number): GridColumn<any>[] {
  return [
    {
      key: 'score',
      header: 'Match',
      sortValue: (m) => m.score,
      cell: (m) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-12 rounded bg-muted">
            <div
              className="h-1.5 rounded bg-primary"
              style={{ width: `${Math.round((m.score / maxScore) * 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{m.score.toFixed(1)}</span>
        </div>
      ),
    },
    {
      key: 'rfqNumber',
      header: 'RFQ / part',
      cell: (m) => (
        <>
          <span className="font-medium">{m.rfqNumber}</span> R{m.revisionNo}
          <div className="text-xs text-muted-foreground">
            {m.customerPartNumber} · {m.partName}
          </div>
        </>
      ),
    },
    { key: 'customerCode', header: 'Customer', cell: (m) => m.customerCode ?? '—' },
    {
      key: 'productType',
      header: 'Type · grade',
      cell: (m) => `${m.productType ?? '—'}${m.materialGrade ? ` · ${m.materialGrade}` : ''}`,
    },
    {
      key: 'dims',
      header: 'Key dims',
      noSort: true,
      cell: (m) => <span className="text-xs">{dims(m.keyDims)}</span>,
    },
    {
      key: 'quotedPricePerPc',
      header: 'Quoted /pc',
      align: 'right',
      sortValue: (m) => Number(m.quotedPricePerPc ?? -1),
      cell: (m) => money(m.quotedPricePerPc),
    },
    {
      key: 'actualCost',
      header: 'Actual /pc',
      align: 'right',
      sortValue: (m) => Number(m.actualCost ?? -1),
      cell: (m) => money(m.actualCost),
    },
    { key: 'outcome', header: 'Outcome', cell: (m) => <StatusBadge status={m.outcome} /> },
  ]
}
