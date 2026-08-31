import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  FileText,
  Package,
  Database,
  ScrollText,
  LogOut,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
  Sun,
  Moon,
  User,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { MASTER_GROUPS } from '@/features/masters/configs'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  )

const readBool = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = () => {
    setDark((d) => {
      const next = !d
      document.documentElement.classList.toggle('dark', next)
      try {
        localStorage.setItem('theme', next ? 'dark' : 'light')
      } catch {
        /* ignore */
      }
      return next
    })
  }
  return { dark, toggle }
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout, isAdminOrManager } = useAuth()
  const navigate = useNavigate()
  const { dark, toggle } = useTheme()

  const [navOpen, setNavOpen] = useState(() => readBool('navOpen', true))
  const [mastersOpen, setMastersOpen] = useState(() => readBool('mastersOpen', true))
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem('navOpen', navOpen ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [navOpen])
  useEffect(() => {
    try {
      localStorage.setItem('mastersOpen', mastersOpen ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [mastersOpen])

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const doLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="fixed inset-x-0 top-0 z-30 h-14 border-b bg-card flex items-center gap-2 px-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setNavOpen((o) => !o)}
          aria-label={navOpen ? 'Hide navigation' : 'Show navigation'}
        >
          {navOpen ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeft className="h-5 w-5" />}
        </Button>
        <span className="font-bold">RFQ &amp; Costing</span>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
            {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>

          <div className="relative" ref={menuRef}>
            <Button variant="ghost" className="gap-2" onClick={() => setMenuOpen((o) => !o)}>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-muted text-xs font-semibold">
                {(user?.name ?? '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden sm:inline text-sm">{user?.name}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 w-56 rounded-md border bg-card shadow-lg p-1 text-sm">
                <div className="px-3 py-2">
                  <div className="font-medium flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" /> {user?.name}
                  </div>
                  <div className="text-xs text-muted-foreground">{user?.email}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {user?.roles.join(', ')}
                  </div>
                </div>
                <div className="my-1 border-t" />
                <button
                  className="flex w-full items-center gap-2 rounded px-3 py-1.5 hover:bg-muted"
                  onClick={() => {
                    toggle()
                    setMenuOpen(false)
                  }}
                >
                  {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  {dark ? 'Light theme' : 'Dark theme'}
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-red-500 hover:bg-muted"
                  onClick={doLogout}
                >
                  <LogOut className="h-4 w-4" /> Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-14 bottom-0 z-20 w-60 border-r bg-card overflow-y-auto transition-transform',
          navOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <nav className="p-3 space-y-1">
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
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setMastersOpen((o) => !o)}
          >
            <Database className="h-4 w-4" /> Masters
            <ChevronDown
              className={cn('h-4 w-4 ml-auto transition-transform', mastersOpen && 'rotate-180')}
            />
          </button>
          {mastersOpen && (
            <div className="ml-3 border-l pl-2 space-y-0.5">
              {MASTER_GROUPS.map((g) => (
                <NavLink key={g.key} to={`/masters/${g.key}`} className={navLinkClass}>
                  <span className="truncate">{g.title}</span>
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
      </aside>

      {/* Content — full width */}
      <main
        className={cn(
          'min-h-screen bg-muted/40 pt-14 transition-[padding]',
          navOpen ? 'lg:pl-60' : 'pl-0'
        )}
      >
        <div className="w-full px-4 py-6 sm:px-6">{children}</div>
      </main>
    </div>
  )
}
