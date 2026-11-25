import { ReactNode, useEffect, useMemo, useState } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface GridColumn<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** value used for sorting — defaults to `row[key]` */
  sortValue?: (row: T) => unknown
  /** disable sorting on this column */
  noSort?: boolean
  /** server mode: the field name sent as `sort` to the API (defaults to `key`) */
  sortKey?: string
  align?: 'left' | 'right'
  className?: string
}

export type GridSort = { key: string; dir: 'asc' | 'desc' } | null

/**
 * Server-side mode: the parent fetches ONE page and owns the paging / sorting state. `page` is
 * 0-based. `rows` is then just the current page; `total` is the full filtered count.
 */
export interface ServerPaging {
  page: number
  pageSize: number
  total: number
  sort: GridSort
  onChange: (next: { page: number; pageSize: number; sort: GridSort }) => void
}

interface DataGridProps<T> {
  columns: GridColumn<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  /** trailing, non-sortable actions column */
  actions?: (row: T) => ReactNode
  actionsHeader?: ReactNode
  loading?: boolean
  emptyText?: string
  pageSize?: number
  /** rendered above the table (search, filters) */
  toolbar?: ReactNode
  /** omit for the classic client-side sort + pagination over `rows` */
  server?: ServerPaging
}

const PAGE_SIZES = [10, 25, 50, 100]

function compare(a: unknown, b: unknown): number {
  const an = a == null || a === ''
  const bn = b == null || b === ''
  if (an && bn) return 0
  if (an) return 1 // nulls last
  if (bn) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const ad = Date.parse(String(a))
  const bd = Date.parse(String(b))
  if (!Number.isNaN(ad) && !Number.isNaN(bd) && /\d{4}-\d{2}-\d{2}/.test(String(a))) return ad - bd
  const na = Number(a)
  const nb = Number(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '')
    return na - nb
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

export default function DataGrid<T>({
  columns,
  rows,
  getRowKey,
  actions,
  actionsHeader = 'Actions',
  loading,
  emptyText = 'No records.',
  pageSize: initialPageSize = 10,
  toolbar,
  server,
}: DataGridProps<T>) {
  const [localSort, setLocalSort] = useState<GridSort>(null)
  const [localPageSize, setLocalPageSize] = useState(initialPageSize)
  const [localPage, setLocalPage] = useState(0)

  // In server mode the parent owns this state; otherwise the grid does.
  const sort = server ? server.sort : localSort
  const pageSize = server ? server.pageSize : localPageSize
  const page = server ? server.page : localPage
  const sortKeyOf = (c: GridColumn<T>) => c.sortKey ?? c.key

  const sorted = useMemo(() => {
    if (server || !sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const val = col.sortValue ?? ((r: T) => (r as Record<string, unknown>)[sort.key])
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => compare(val(a), val(b)) * dir)
  }, [rows, sort, columns, server])

  const totalRows = server ? server.total : sorted.length
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize))
  useEffect(() => {
    if (page > pageCount - 1) {
      if (server) server.onChange({ page: 0, pageSize, sort })
      else setLocalPage(0)
    }
  }, [page, pageCount, server, pageSize, sort])

  const start = page * pageSize
  const pageRows = server ? rows : sorted.slice(start, start + pageSize)
  const colSpan = columns.length + (actions ? 1 : 0)

  const setPage = (p: number) => (server ? server.onChange({ page: p, pageSize, sort }) : setLocalPage(p))
  const setPageSize = (n: number) =>
    server ? server.onChange({ page: 0, pageSize: n, sort }) : (setLocalPageSize(n), setLocalPage(0))
  const toggleSort = (key: string) => {
    const next: GridSort =
      sort?.key !== key ? { key, dir: 'asc' } : sort.dir === 'asc' ? { key, dir: 'desc' } : null
    if (server) server.onChange({ page: 0, pageSize, sort: next })
    else setLocalSort(next)
  }

  return (
    <div className="space-y-3">
      {toolbar}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => {
                const active = sort?.key === sortKeyOf(c)
                return (
                  <TableHead key={c.key} className={cn(c.align === 'right' && 'text-right', c.className)}>
                    {c.noSort ? (
                      c.header
                    ) : (
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort(sortKeyOf(c))}
                      >
                        {c.header}
                        {active ? (
                          sort!.dir === 'asc' ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </button>
                    )}
                  </TableHead>
                )
              })}
              {actions && <TableHead className="w-32 text-right">{actionsHeader}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={colSpan}>Loading…</TableCell>
              </TableRow>
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-muted-foreground">
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => (
                <TableRow key={getRowKey(row)}>
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(c.align === 'right' && 'text-right', c.className)}
                    >
                      {c.cell(row)}
                    </TableCell>
                  ))}
                  {actions && (
                    <TableCell className="text-right whitespace-nowrap">{actions(row)}</TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <div>
          {totalRows === 0
            ? '0 of 0'
            : `${start + 1}–${Math.min(start + pageSize, totalRows)} of ${totalRows}`}
        </div>
        <div className="flex items-center gap-2">
          <span>Rows</span>
          <Select
            className="h-9 w-[4.75rem] px-2 py-0"
            value={String(pageSize)}
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(Math.max(0, page - 1))}
          >
            Prev
          </Button>
          <span>
            {page + 1} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount - 1}
            onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
