import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { apiClient } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

const actionVariant: Record<string, 'default' | 'success' | 'warning' | 'destructive' | 'secondary'> = {
  CREATE: 'success',
  UPDATE: 'default',
  DELETE: 'destructive',
  COMPUTE: 'secondary',
  QUOTE: 'warning',
  ANALYZE: 'secondary',
  REVIEW: 'secondary',
}

export default function AuditLogPage() {
  const { isAdminOrManager } = useAuth()
  const [entityType, setEntityType] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', entityType],
    queryFn: () =>
      apiClient
        .get('/audit-log', { params: { entityType: entityType || undefined, limit: 200 } })
        .then((r) => r.data),
  })

  if (!isAdminOrManager) return <Navigate to="/" replace />

  const rows = (data as any[]) ?? []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every master change and every quote (AI-recommended vs final) is recorded.
        </p>
      </div>

      <Input
        className="max-w-xs"
        placeholder="Filter by entity type (e.g. Machine, RfqVersion)"
        value={entityType}
        onChange={(e) => setEntityType(e.target.value)}
      />

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5}>Loading…</TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No audit entries.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-sm">{r.by?.name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={actionVariant[r.action] ?? 'secondary'}>{r.action}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.entityType} <span className="text-muted-foreground">#{r.entityId}</span>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs text-muted-foreground break-all">
                      {typeof r.changes === 'string' ? r.changes : JSON.stringify(r.changes)}
                    </code>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
