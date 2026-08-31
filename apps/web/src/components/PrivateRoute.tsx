import { Navigate } from 'react-router-dom'
import AppShell from './AppShell'
import { useAuth } from '@/lib/auth'

type Cap = 'masters' | 'rfq' | 'admin'

export default function PrivateRoute({
  children,
  cap,
}: {
  children: React.ReactNode
  cap?: Cap
}) {
  const token = localStorage.getItem('token')
  const { canEditMasters, canEditRfq, isAdmin } = useAuth()
  if (!token) return <Navigate to="/login" replace />

  const denied =
    (cap === 'masters' && !canEditMasters) ||
    (cap === 'rfq' && !canEditRfq) ||
    (cap === 'admin' && !isAdmin)
  if (denied) return <Navigate to="/" replace />

  return <AppShell>{children}</AppShell>
}
