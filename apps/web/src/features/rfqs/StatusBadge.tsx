import { Badge } from '@/components/ui/badge'

const map: Record<string, 'secondary' | 'default' | 'warning' | 'success' | 'destructive'> = {
  DRAFT: 'secondary',
  COSTED: 'default',
  QUOTED: 'warning',
  WON: 'success',
  LOST: 'destructive',
}

export function StatusBadge({ status }: { status?: string | null }) {
  const s = status ?? 'DRAFT'
  return <Badge variant={map[s] ?? 'secondary'}>{s}</Badge>
}
