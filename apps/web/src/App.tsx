import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider } from './lib/auth'
import LoginPage from './pages/Login'
import DashboardPage from './pages/Dashboard'
import AuditLogPage from './pages/AuditLog'
import CompanySettingsPage from './pages/CompanySettings'
import SecurityPage from './pages/Security'
import RfqListPage from './features/rfqs/RfqListPage'
import RfqDetailPage from './features/rfqs/RfqDetailPage'
import CreateRfqWizard from './features/rfqs/CreateRfqWizard'
import MasterPage from './features/masters/MasterPage'
import MasterGroupPage from './features/masters/MasterGroupPage'
import { customerPartConfig } from './features/rfqs/customerPartConfig'
import PrivateRoute from './components/PrivateRoute'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

const protect = (el: React.ReactNode, cap?: 'masters' | 'rfq' | 'admin') => (
  <PrivateRoute cap={cap}>{el}</PrivateRoute>
)

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={protect(<DashboardPage />)} />
            <Route path="/rfqs" element={protect(<RfqListPage />)} />
            <Route path="/rfqs/new" element={protect(<CreateRfqWizard />, 'rfq')} />
            <Route path="/rfqs/:id" element={protect(<RfqDetailPage />)} />
            <Route
              path="/customer-parts"
              element={protect(<MasterPage config={customerPartConfig} />, 'rfq')}
            />
            <Route path="/masters/:group" element={protect(<MasterGroupPage />, 'masters')} />
            <Route path="/masters/:group/:tab" element={protect(<MasterGroupPage />, 'masters')} />
            <Route path="/audit-log" element={protect(<AuditLogPage />)} />
            <Route path="/company" element={protect(<CompanySettingsPage />)} />
            <Route path="/security" element={protect(<SecurityPage />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </QueryClientProvider>
  )
}
