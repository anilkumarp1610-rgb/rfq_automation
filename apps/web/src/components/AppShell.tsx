import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  FileText,
  Package,
  Database,
  ScrollText,
  LogOut,
  ChevronDown,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { MASTERS } from '@/features/masters/configs'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:bg-slate-100'
  )

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout, isAdminOrManager } = useAuth()
  const navigate = useNavigate()
  const [mastersOpen, setMastersOpen] = useState(true)

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 w-60 border-r bg-white flex flex-col">
        <div className="h-14 flex items-center px-4 border-b font-bold">RFQ &amp; Costing</div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          <NavLink to="/" end className={navLinkClass}>
            <LayoutDashboard className="h-4 w-4" /> Dashboard
          </NavLink>
          <NavLink to="/rfqs" className={navLinkClass}>
            <FileText className="h-4 w-4" /> RFQs
          </NavLink>
          <NavLink to="/customer-parts" className={navLinkClass}>
            <Package className="h-4 w-4" /> Customer Parts
          </NavLink>

          <button
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            onClick={() => setMastersOpen((o) => !o)}
          >
            <Database className="h-4 w-4" /> Masters
            <ChevronDown
              className={cn('h-4 w-4 ml-auto transition-transform', mastersOpen && 'rotate-180')}
            />
          </button>
          {mastersOpen && (
            <div className="ml-3 border-l pl-2 space-y-0.5">
              {MASTERS.map((m) => (
                <NavLink key={m.key} to={`/masters/${m.key}`} className={navLinkClass}>
                  <span className="truncate">{m.title}</span>
                </NavLink>
              ))}
            </div>
          )}

          {isAdminOrManager && (
            <NavLink to="/audit-log" className={navLinkClass}>
              <ScrollText className="h-4 w-4" /> Audit Log
            </NavLink>
          )}
        </nav>
        <div className="border-t p-3">
          <div className="text-xs text-slate-500 mb-2">
            {user?.name}
            <br />
            <span className="text-slate-400">{user?.roles.join(', ')}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              logout()
              navigate('/login')
            }}
          >
            <LogOut className="h-4 w-4 mr-1" /> Logout
          </Button>
        </div>
      </aside>

      <main className="pl-60">
        <div className="max-w-6xl mx-auto p-6">{children}</div>
      </main>
    </div>
  )
}
