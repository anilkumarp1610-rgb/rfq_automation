import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider } from './lib/auth'
import LoginPage from './pages/Login'
import DashboardPage from './pages/Dashboard'
import AuditLogPage from './pages/AuditLog'
import RfqListPage from './features/rfqs/RfqListPage'
import RfqDetailPage from './features/rfqs/RfqDetailPage'
import MasterPage from './features/masters/MasterPage'
import { customerPartConfig } from './features/rfqs/customerPartConfig'
import PrivateRoute, { MasterRoute } from './components/PrivateRoute'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

const protect = (el: React.ReactNode) => <PrivateRoute>{el}</PrivateRoute>

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={protect(<DashboardPage />)} />
            <Route path="/rfqs" element={protect(<RfqListPage />)} />
            <Route path="/rfqs/:id" element={protect(<RfqDetailPage />)} />
            <Route
              path="/customer-parts"
              element={protect(<MasterPage config={customerPartConfig} />)}
            />
            <Route path="/masters/:key" element={protect(<MasterRoute />)} />
            <Route path="/audit-log" element={protect(<AuditLogPage />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </QueryClientProvider>
  )
}
