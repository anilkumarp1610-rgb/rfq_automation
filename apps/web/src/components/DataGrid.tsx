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
  align?: 'left' | 'right'
  className?: string
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
}: DataGridProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const val = col.sortValue ?? ((r: T) => (r as Record<string, unknown>)[sort.key])
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => compare(val(a), val(b)) * dir)
  }, [rows, sort, columns])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  useEffect(() => {
    if (page > pageCount - 1) setPage(0)
  }, [page, pageCount])

  const start = page * pageSize
  const pageRows = sorted.slice(start, start + pageSize)
  const colSpan = columns.length + (actions ? 1 : 0)

  const toggleSort = (key: string) =>
    setSort((s) =>
      s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null
    )

  return (
    <div className="space-y-3">
      {toolbar}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => {
                const active = sort?.key === c.key
                return (
                  <TableHead key={c.key} className={cn(c.align === 'right' && 'text-right', c.className)}>
                    {c.noSort ? (
                      c.header
                    ) : (
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort(c.key)}
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
          {sorted.length === 0
            ? '0 of 0'
            : `${start + 1}–${Math.min(start + pageSize, sorted.length)} of ${sorted.length}`}
        </div>
        <div className="flex items-center gap-2">
          <span>Rows</span>
          <Select
            className="h-9 w-[4.75rem] px-2 py-0"
            value={String(pageSize)}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(0)
            }}
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
            onClick={() => setPage((p) => Math.max(0, p - 1))}
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
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
