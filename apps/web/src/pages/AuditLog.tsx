import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { apiClient, pagingParams } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import DataGrid, { type GridColumn, type GridSort } from '@/components/DataGrid'

const actionVariant: Record<string, 'default' | 'success' | 'warning' | 'destructive' | 'secondary'> = {
  CREATE: 'success',
  UPDATE: 'default',
  DELETE: 'destructive',
  COMPUTE: 'secondary',
  QUOTE: 'warning',
  ANALYZE: 'secondary',
  REVIEW: 'secondary',
}

type Row = Record<string, any>

export default function AuditLogPage() {
  const { isAdminOrManager } = useAuth()
  const [entityType, setEntityType] = useState('')
  // The log only ever grows, so it is paged on the server (newest first) rather than capped at 500.
  const [paging, setPaging] = useState<{ page: number; pageSize: number; sort: GridSort }>({
    page: 0,
    pageSize: 25,
    sort: null,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', entityType, paging.page, paging.pageSize],
    queryFn: () =>
      apiClient
        .get('/audit-log', {
          params: { entityType: entityType || undefined, ...pagingParams({ ...paging, sort: null }) },
        })
        .then((r) => ({ rows: r.data as Row[], total: Number(r.headers['x-total-count'] ?? r.data.length) })),
    placeholderData: keepPreviousData,
    enabled: isAdminOrManager,
  })

  if (!isAdminOrManager) return <Navigate to="/" replace />

  const rows = data?.rows ?? []

  const columns: GridColumn<Row>[] = [
    {
      key: 'createdAt',
      header: 'When',
      noSort: true,
      cell: (r) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {new Date(r.createdAt).toLocaleString()}
        </span>
      ),
    },
    { key: 'by', header: 'By', noSort: true, cell: (r) => r.by?.name ?? '—' },
    {
      key: 'action',
      header: 'Action',
      noSort: true,
      cell: (r) => <Badge variant={actionVariant[r.action] ?? 'secondary'}>{r.action}</Badge>,
    },
    {
      key: 'entityType',
      header: 'Entity',
      noSort: true,
      cell: (r) => (
        <span className="text-sm">
          {r.entityType} <span className="text-muted-foreground">#{r.entityId}</span>
        </span>
      ),
    },
    {
      key: 'changes',
      header: 'Changes',
      noSort: true,
      cell: (r) => (
        <code className="text-xs text-muted-foreground break-all">
          {typeof r.changes === 'string' ? r.changes : JSON.stringify(r.changes)}
        </code>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every master change and every quote (AI-recommended vs final) is recorded.
        </p>
      </div>

      <DataGrid
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        loading={isLoading}
        emptyText="No audit entries."
        server={{ ...paging, total: data?.total ?? 0, onChange: setPaging }}
        toolbar={
          <Input
            className="max-w-xs"
            placeholder="Filter by entity type (e.g. Machine, RfqVersion)"
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value)
              setPaging((p) => ({ ...p, page: 0 }))
            }}
          />
        }
      />
    </div>
  )
}
