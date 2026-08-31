import { Navigate, useSearchParams } from 'react-router-dom'
import { Users, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import UsersSection from './Users'
import RolesSection from './Roles'

const TABS = [
  { key: 'users', label: 'Users', icon: Users },
  { key: 'roles', label: 'Roles', icon: ShieldCheck },
] as const

export default function SecurityPage() {
  const { isAdmin } = useAuth()
  const [params, setParams] = useSearchParams()
  if (!isAdmin) return <Navigate to="/" replace />

  const active = params.get('tab') === 'roles' ? 'roles' : 'users'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Security</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage who can sign in and what each role is allowed to do.
        </p>
      </div>

      {/* Users / Roles switch */}
      <div className="inline-flex rounded-lg border bg-muted/40 p-1">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => setParams(t.key === 'users' ? {} : { tab: t.key }, { replace: true })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                active === t.key
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {active === 'users' ? <UsersSection /> : <RolesSection />}
    </div>
  )
}
