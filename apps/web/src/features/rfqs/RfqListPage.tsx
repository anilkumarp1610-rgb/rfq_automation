import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Search, Plus } from 'lucide-react'
import { RFQ_STATUSES } from '@rfq/shared'
import { resource } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/field'
import DataGrid, { type GridColumn } from '@/components/DataGrid'
import { StatusBadge } from './StatusBadge'
import CreateRfqDialog from './CreateRfqDialog'
import { useAuth } from '@/lib/auth'

const rfqApi = resource('/rfqs')
const fmtDate = (d?: string | null) => (d ? String(d).slice(0, 10) : '—')
const fmtMoney = (n?: string | number | null) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

type Row = Record<string, any>
const current = (r: Row) => r.versions?.[0]

export default function RfqListPage() {
  const { canEditRfq } = useAuth()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['rfqs', search, status],
    queryFn: () => rfqApi.list({ search: search || undefined, status: status || undefined }),
  })

  const rows = (data as Row[]) ?? []

  const columns: GridColumn<Row>[] = [
    {
      key: 'rfqNumber',
      header: 'RFQ #',
      cell: (r) => (
        <Link className="font-medium text-primary hover:underline" to={`/rfqs/${r.id}`}>
          {r.rfqNumber}
        </Link>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (r) => r.customerPart?.customer?.code,
      cell: (r) => r.customerPart?.customer?.code ?? '—',
    },
    {
      key: 'part',
      header: 'Part',
      sortValue: (r) => r.customerPart?.customerPartNumber,
      cell: (r) => (
        <>
          {r.customerPart?.customerPartNumber}
          <span className="text-muted-foreground"> · {r.customerPart?.partName}</span>
        </>
      ),
    },
    {
      key: 'rev',
      header: 'Current rev',
      sortValue: (r) => current(r)?.revisionNo ?? 0,
      cell: (r) => (current(r) ? `R${current(r).revisionNo}` : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (r) => current(r)?.status ?? r.status,
      cell: (r) => <StatusBadge status={current(r)?.status ?? r.status} />,
    },
    {
      key: 'quoted',
      header: 'Quoted / pc',
      align: 'right',
      sortValue: (r) => Number(current(r)?.costSummary?.quotedPricePerPc ?? -1),
      cell: (r) => fmtMoney(current(r)?.costSummary?.quotedPricePerPc),
    },
    {
      key: 'rfqDate',
      header: 'RFQ date',
      sortValue: (r) => r.rfqDate,
      cell: (r) => fmtDate(r.rfqDate),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">RFQs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Each RFQ carries one or more revision-based versions with its own cost sheet.
          </p>
        </div>
        {canEditRfq && (
          <div className="flex items-center gap-2">
            <Link to="/rfqs/new">
              <Button>
                <Plus className="h-4 w-4 mr-1" /> New RFQ from spec
              </Button>
            </Link>
            <CreateRfqDialog />
          </div>
        )}
      </div>

      <DataGrid
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        loading={isLoading}
        emptyText="No RFQs yet."
        toolbar={
          <div className="flex flex-wrap gap-3">
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search RFQ / part…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              className="max-w-[12rem]"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {RFQ_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        }
      />
    </div>
  )
}
