import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, apiError, resource } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import DataGrid, { type GridColumn } from '@/components/DataGrid'

const rolesApi = resource('/roles')

interface Role {
  id: string
  code: string
  name: string
  description: string | null
  isSystem: boolean
  userCount: number
}

const blank = { code: '', name: '', description: '' }
type Form = typeof blank

export default function RolesSection() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Role | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<Form>(blank)
  const set = (patch: Partial<Form>) => setForm((s) => ({ ...s, ...patch }))

  const { data, isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiClient.get('/roles').then((r) => r.data),
  })
  const roles = (data as Role[]) ?? []

  useEffect(() => {
    if (creating) setForm(blank)
    else if (editing)
      setForm({ code: editing.code, name: editing.name, description: editing.description ?? '' })
  }, [creating, editing])

  const close = () => {
    setEditing(null)
    setCreating(false)
  }

  const save = useMutation({
    mutationFn: () =>
      editing
        ? rolesApi.update(editing.id, { name: form.name, description: form.description || undefined })
        : rolesApi.create({
            code: form.code,
            name: form.name,
            description: form.description || undefined,
          }),
    onSuccess: () => {
      toast.success(editing ? 'Role updated' : 'Role created')
      qc.invalidateQueries({ queryKey: ['roles'] })
      close()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const columns: GridColumn<Role>[] = [
    {
      key: 'name',
      header: 'Role',
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          <span className="font-medium">{r.name}</span>
          {r.isSystem ? (
            <Badge variant="outline">Built-in</Badge>
          ) : (
            <Badge variant="secondary">Custom</Badge>
          )}
        </span>
      ),
    },
    { key: 'code', header: 'Code', cell: (r) => <code className="text-xs">{r.code}</code> },
    {
      key: 'description',
      header: 'What it can do',
      noSort: true,
      cell: (r) => <span className="text-muted-foreground">{r.description || '—'}</span>,
    },
    {
      key: 'userCount',
      header: 'Users',
      align: 'right',
      cell: (r) => r.userCount,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Roles</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Built-in roles have fixed permissions — you can rename them and edit the description.
            Custom roles you add are treated as <strong>view-only</strong>.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1" /> New role
        </Button>
      </div>

      <DataGrid
        columns={columns}
        rows={roles}
        getRowKey={(r) => r.id}
        loading={isLoading}
        emptyText="No roles."
        actions={(r) => (
          <Button variant="ghost" size="icon" onClick={() => setEditing(r)} aria-label="Edit">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      />

      <Dialog open={creating || !!editing} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New role'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            {!editing && (
              <div className="grid gap-1.5">
                <Label>Code</Label>
                <Input
                  value={form.code}
                  onChange={(e) => set({ code: e.target.value.toUpperCase() })}
                  placeholder="e.g. AUDITOR"
                />
                <span className="text-xs text-muted-foreground">
                  Uppercase identifier, cannot change later.
                </span>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="What this role is allowed to do"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={
                save.isPending || form.name.trim().length < 2 || (!editing && form.code.trim().length < 2)
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
