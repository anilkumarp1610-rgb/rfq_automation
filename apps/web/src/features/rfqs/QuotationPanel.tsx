import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileDown, FileSpreadsheet, FileText, Check } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, apiError, downloadFile } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function QuotationPanel({
  versionId,
  quoteNo,
  hasCost,
  status,
  canEdit,
  onChanged,
}: {
  versionId: string
  quoteNo: string
  hasCost: boolean
  status: string
  canEdit: boolean
  onChanged: () => void
}) {
  const qc = useQueryClient()

  const generate = useMutation({
    mutationFn: () => apiClient.post(`/rfq-versions/${versionId}/quote`, {}).then((r) => r.data),
    onSuccess: () => {
      toast.success('Quotation generated — revision marked QUOTED')
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onChanged()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  const dl = (ext: 'cost-sheet.pdf' | 'cost-sheet.xlsx' | 'quotation.pdf', name: string) =>
    downloadFile(`/rfq-versions/${versionId}/${ext}`, name).catch((e) => toast.error(apiError(e)))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Quotation &amp; export</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasCost && (
          <p className="text-sm text-amber-600">Compute the cost first to enable the quotation.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button onClick={() => generate.mutate()} disabled={!hasCost || generate.isPending}>
              <Check className="h-4 w-4 mr-1" />
              {status === 'QUOTED' || status === 'WON' || status === 'LOST'
                ? 'Re-generate quotation'
                : 'Generate quotation'}
            </Button>
          )}
          <Button variant="outline" disabled={!hasCost} onClick={() => dl('cost-sheet.pdf', `cost-sheet-${quoteNo}.pdf`)}>
            <FileText className="h-4 w-4 mr-1" /> Cost sheet (PDF)
          </Button>
          <Button variant="outline" disabled={!hasCost} onClick={() => dl('cost-sheet.xlsx', `cost-sheet-${quoteNo}.xlsx`)}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Cost sheet (Excel)
          </Button>
          <Button variant="outline" disabled={!hasCost} onClick={() => dl('quotation.pdf', `quotation-${quoteNo}.pdf`)}>
            <FileDown className="h-4 w-4 mr-1" /> Quotation (PDF)
          </Button>
        </div>
        {hasCost && <p className="text-xs text-slate-400">Quote no. {quoteNo}</p>}
      </CardContent>
    </Card>
  )
}
