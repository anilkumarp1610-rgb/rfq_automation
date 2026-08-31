import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { authApi, apiClient } from './api'

export interface AuthUser {
  id: string
  email: string
  name: string
  roles: string[]
}

interface AuthState {
  user: AuthUser | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  canEditMasters: boolean
  canEditRfq: boolean
  isAdminOrManager: boolean
  isAdmin: boolean
}

const AuthContext = createContext<AuthState | undefined>(undefined)

function readUser(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(readUser)

  // Re-hydrate roles from the server on load (they may have changed).
  useEffect(() => {
    if (!localStorage.getItem('token')) return
    apiClient
      .get('/auth/me')
      .then((r) => {
        localStorage.setItem('user', JSON.stringify(r.data))
        setUser(r.data)
      })
      .catch(() => {
        /* 401 handled by the axios interceptor */
      })
  }, [])

  const login = async (email: string, password: string) => {
    const data = await authApi.login(email, password)
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    setUser(data.user)
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  const has = (...roles: string[]) => !!user?.roles.some((r) => roles.includes(r))

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        canEditMasters: has('ADMIN', 'MANAGER'),
        canEditRfq: has('ADMIN', 'MANAGER', 'ESTIMATOR'),
        isAdminOrManager: has('ADMIN', 'MANAGER'),
        isAdmin: has('ADMIN'),
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
