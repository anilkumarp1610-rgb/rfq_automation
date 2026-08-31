import { Navigate, useParams } from 'react-router-dom'
import AppShell from './AppShell'
import MasterPage from '@/features/masters/MasterPage'
import { MASTER_BY_KEY } from '@/features/masters/configs'

export default function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token')
  if (!token) return <Navigate to="/login" replace />
  return <AppShell>{children}</AppShell>
}

/** Route element for `/masters/:key` — resolves the config by url param. */
export function MasterRoute() {
  const { key = '' } = useParams()
  const config = MASTER_BY_KEY[key]
  if (!config) return <Navigate to="/" replace />
  return <MasterPage key={key} config={config} />
}
