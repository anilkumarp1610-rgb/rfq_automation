import axios, { AxiosError } from 'axios'

export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

apiClient.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    if (error.response?.status === 401 && !location.pathname.startsWith('/login')) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      location.href = '/login'
    }
    return Promise.reject(error)
  }
)

/** Pull a human-readable message out of an axios error. */
export function apiError(err: unknown): string {
  const e = err as AxiosError<{ error?: string; issues?: { path: string; message: string }[] }>
  const data = e.response?.data
  if (data?.issues?.length) return data.issues.map((i) => `${i.path}: ${i.message}`).join(', ')
  return data?.error || e.message || 'Something went wrong'
}

/** Fetch a file (with the auth header) and trigger a browser download. */
export async function downloadFile(path: string, filename: string) {
  const res = await apiClient.get(path, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post('/auth/login', { email, password }).then((r) => r.data),
}

/** Generic REST resource bound to a collection endpoint. */
export function resource<T = any>(path: string) {
  return {
    list: (params?: Record<string, unknown>) =>
      apiClient.get<T[]>(path, { params }).then((r) => r.data),
    get: (id: string) => apiClient.get<T>(`${path}/${id}`).then((r) => r.data),
    create: (body: unknown) => apiClient.post<T>(path, body).then((r) => r.data),
    update: (id: string, body: unknown) =>
      apiClient.put<T>(`${path}/${id}`, body).then((r) => r.data),
    remove: (id: string) => apiClient.delete(`${path}/${id}`).then((r) => r.data),
  }
}
