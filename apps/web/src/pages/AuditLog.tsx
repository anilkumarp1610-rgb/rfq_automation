import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { apiClient } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import DataGrid, { type GridColumn } from '@/components/DataGrid'

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

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', entityType],
    queryFn: () =>
      apiClient
        .get('/audit-log', { params: { entityType: entityType || undefined, limit: 500 } })
        .then((r) => r.data),
  })

  if (!isAdminOrManager) return <Navigate to="/" replace />

  const rows = (data as Row[]) ?? []

  const columns: GridColumn<Row>[] = [
    {
      key: 'createdAt',
      header: 'When',
      cell: (r) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {new Date(r.createdAt).toLocaleString()}
        </span>
      ),
    },
    { key: 'by', header: 'By', sortValue: (r) => r.by?.name, cell: (r) => r.by?.name ?? '—' },
    {
      key: 'action',
      header: 'Action',
      cell: (r) => <Badge variant={actionVariant[r.action] ?? 'secondary'}>{r.action}</Badge>,
    },
    {
      key: 'entityType',
      header: 'Entity',
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
        pageSize={25}
        toolbar={
          <Input
            className="max-w-xs"
            placeholder="Filter by entity type (e.g. Machine, RfqVersion)"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
          />
        }
      />
    </div>
  )
}
