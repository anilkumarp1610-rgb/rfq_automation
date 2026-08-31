import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { apiClient } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/features/rfqs/StatusBadge'

const money = (n: number) =>
  `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiClient.get('/reports/dashboard').then((r) => r.data),
  })

  const d = data as any
  const kpis = [
    { label: 'RFQs', value: d?.counts.rfqs },
    { label: 'Customer parts', value: d?.counts.parts },
    { label: 'Quoted (open)', value: d?.counts.quoted },
    {
      label: 'Win rate',
      value: d?.winRate == null ? '—' : `${Math.round(d.winRate * 100)}%`,
      sub: `${d?.counts.won ?? 0} won / ${d?.counts.lost ?? 0} lost`,
    },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{k.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{isLoading ? '…' : (k.value ?? 0)}</div>
              {k.sub && <p className="text-xs text-muted-foreground mt-1">{k.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{d ? money(d.pipelineValue) : '…'}</div>
            <p className="text-xs text-muted-foreground mt-1">Quoted, awaiting decision</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Won value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{d ? money(d.wonValue) : '…'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active customers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{d?.counts.customers ?? '…'}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>RFQ activity</CardTitle>
          <CardDescription>Last 6 months — raised, quoted, won</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={d?.monthly ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="rfqs" name="RFQs" fill="#3b82f6" />
              <Bar dataKey="quoted" name="Quoted" fill="#8b5cf6" />
              <Bar dataKey="won" name="Won" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {(d?.recent ?? []).map((r: any) => (
              <li key={r.rfqVersionId} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <Link className="font-medium text-primary hover:underline" to={`/rfqs/${r.rfqId}`}>
                    {r.rfqNumber}
                  </Link>{' '}
                  R{r.revisionNo}
                  <span className="text-muted-foreground"> · {r.part} · {r.customer ?? '—'}</span>
                </div>
                <div className="flex items-center gap-3">
                  {r.quotedPricePerPc != null && (
                    <span className="text-muted-foreground">₹{Number(r.quotedPricePerPc).toLocaleString('en-IN')}/pc</span>
                  )}
                  <StatusBadge status={r.status} />
                </div>
              </li>
            ))}
            {!isLoading && (d?.recent ?? []).length === 0 && (
              <li className="py-2 text-sm text-muted-foreground">No RFQ activity yet.</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
