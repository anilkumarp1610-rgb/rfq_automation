import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, apiError, resource } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import DataGrid, { type GridColumn } from '@/components/DataGrid'

const usersApi = resource('/users')

interface Role {
  id: string
  code: string
  name: string
}
interface User {
  id: string
  name: string
  email: string
  phone: string | null
  isActive: boolean
  createdAt: string
  role: Role | null
}

const blank = { name: '', email: '', phone: '', password: '', roleId: '', isActive: true }
type Form = typeof blank

export default function UsersSection() {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<User | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<Form>(blank)
  const set = (patch: Partial<Form>) => setForm((s) => ({ ...s, ...patch }))

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() })
  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiClient.get('/roles').then((r) => r.data),
  })
  const roles = (rolesQuery.data as (Role & { userCount: number })[]) ?? []
  const users = (usersQuery.data as User[]) ?? []

  useEffect(() => {
    if (creating) setForm({ ...blank, roleId: roles.find((r) => r.code === 'VIEWER')?.id ?? '' })
    else if (editing)
      setForm({
        name: editing.name,
        email: editing.email,
        phone: editing.phone ?? '',
        password: '',
        roleId: editing.role?.id ?? '',
        isActive: editing.isActive,
      })
  }, [creating, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setEditing(null)
    setCreating(false)
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        roleId: form.roleId,
        isActive: form.isActive,
        password: form.password || undefined,
      }
      return editing ? usersApi.update(editing.id, body) : usersApi.create(body)
    },
    onSuccess: () => {
      toast.success(editing ? 'User updated' : 'User created')
      qc.invalidateQueries({ queryKey: ['users'] })
      close()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const deactivate = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      toast.success('User deactivated')
      qc.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const columns: GridColumn<User>[] = [
    { key: 'name', header: 'Name', cell: (u) => <span className="font-medium">{u.name}</span> },
    { key: 'email', header: 'Email', cell: (u) => u.email },
    { key: 'phone', header: 'Contact number', cell: (u) => u.phone || '—' },
    {
      key: 'role',
      header: 'Role',
      sortValue: (u) => u.role?.name ?? '',
      cell: (u) => (u.role ? <Badge variant="secondary">{u.role.name}</Badge> : '—'),
    },
    {
      key: 'isActive',
      header: 'Status',
      sortValue: (u) => (u.isActive ? 1 : 0),
      cell: (u) =>
        u.isActive ? (
          <Badge variant="success">Active</Badge>
        ) : (
          <Badge variant="outline">Inactive</Badge>
        ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Each user holds one role. Deactivate to revoke access without losing history.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1" /> New user
        </Button>
      </div>

      <DataGrid
        columns={columns}
        rows={users}
        getRowKey={(u) => u.id}
        loading={usersQuery.isLoading}
        emptyText="No users."
        actions={(u) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => setEditing(u)} aria-label="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!u.isActive || u.id === me?.id}
              onClick={() => {
                if (confirm(`Deactivate ${u.name}?`)) deactivate.mutate(u.id)
              }}
              aria-label="Deactivate"
            >
              <UserX className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        )}
      />

      <Dialog open={creating || !!editing} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New user'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Contact number</Label>
              <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{editing ? 'New password (blank = keep current)' : 'Password'}</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Role</Label>
              <Select value={form.roleId} onChange={(e) => set({ roleId: e.target.value })}>
                <option value="">Select…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            {editing && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => set({ isActive: e.target.checked })}
                />
                Active
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={
                save.isPending ||
                !form.name ||
                !form.email ||
                !form.roleId ||
                (!editing && form.password.length < 6)
              }
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
