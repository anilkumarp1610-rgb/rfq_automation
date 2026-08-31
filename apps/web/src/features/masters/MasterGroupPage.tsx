import { useParams, useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import MasterPage from './MasterPage'
import { MASTER_GROUP_BY_KEY } from './configs'
import type { DrilldownDef } from './types'

export default function MasterGroupPage() {
  const { group = '', tab } = useParams()
  const [sp] = useSearchParams()
  const navigate = useNavigate()

  const g = MASTER_GROUP_BY_KEY[group]
  if (!g) return <Navigate to="/" replace />
  if (!tab) return <Navigate to={`/masters/${group}/${g.tabs[0].key}`} replace />

  const allTabs = [...g.tabs, ...(g.hiddenTabs ?? [])]
  const activeKey = allTabs.some((t) => t.key === tab) ? tab : g.tabs[0].key
  const cfg = allTabs.find((t) => t.key === activeKey)!

  const scope = sp.get('sf')
    ? { field: sp.get('sf')!, id: sp.get('si')!, label: sp.get('sl') ?? '' }
    : undefined

  const onDrill = (dd: DrilldownDef, row: Record<string, any>) => {
    const q = new URLSearchParams({
      sf: dd.targetField,
      si: String(row.id),
      sl: dd.rowLabel(row),
    })
    navigate(`/masters/${group}/${dd.tab}?${q.toString()}`)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{g.title}</h1>
        {g.description && <p className="text-sm text-muted-foreground mt-1">{g.description}</p>}
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {g.tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => navigate(`/masters/${group}/${t.key}`)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              activeKey === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.title}
          </button>
        ))}
        {/* a hidden (drill-down) section shows as a trailing pill while it is active */}
        {g.hiddenTabs?.some((t) => t.key === activeKey) && (
          <span className="-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium text-primary">
            {cfg.title}
          </span>
        )}
      </div>

      {scope && (
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-muted-foreground hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <span className="text-muted-foreground">·</span>
          <span>
            {cfg.title} for <b>{scope.label}</b>
          </span>
        </div>
      )}

      <MasterPage
        key={activeKey + (scope?.id ?? '')}
        config={cfg}
        scope={scope}
        onDrill={onDrill}
        embedded
      />
    </div>
  )
}
