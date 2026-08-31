import { Router, Response } from 'express';
import { authenticateToken, canEditRfq, AuthRequest } from '../middleware/auth.js';
import { ah, bigIntParam } from '../lib/http.js';
import { dashboardSummary } from '../reports/dashboard.js';
import { costSheetViewModel } from '../reports/costSheet.js';
import { costSheetPdf, quotationPdf } from '../reports/pdf.js';
import { costSheetXlsx } from '../reports/xlsx.js';

/** Mounted at /reports */
export const reportsRouter = Router();
reportsRouter.use(authenticateToken);

reportsRouter.get(
  '/dashboard',
  ah(async (_req: AuthRequest, res: Response) => {
    res.json(await dashboardSummary());
  })
);

/** Mounted at /rfq-versions — document downloads (development.plan §7). */
export const downloadRouter = Router();
downloadRouter.use(authenticateToken);

function sendFile(res: Response, buf: Buffer, mime: string, filename: string) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
}

// The internal cost sheet is not for view-only users — they get the quotation only.
downloadRouter.get(
  '/:id/cost-sheet.pdf',
  canEditRfq,
  ah(async (req: AuthRequest, res: Response) => {
    const vm = await costSheetViewModel(bigIntParam(req.params.id));
    sendFile(res, await costSheetPdf(vm), 'application/pdf', `cost-sheet-${vm.quoteNo}.pdf`);
  })
);

downloadRouter.get(
  '/:id/cost-sheet.xlsx',
  canEditRfq,
  ah(async (req: AuthRequest, res: Response) => {
    const vm = await costSheetViewModel(bigIntParam(req.params.id));
    sendFile(
      res,
      await costSheetXlsx(vm),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `cost-sheet-${vm.quoteNo}.xlsx`
    );
  })
);

downloadRouter.get(
  '/:id/quotation.pdf',
  ah(async (req: AuthRequest, res: Response) => {
    const vm = await costSheetViewModel(bigIntParam(req.params.id));
    sendFile(res, await quotationPdf(vm), 'application/pdf', `quotation-${vm.quoteNo}.pdf`);
  })
);
