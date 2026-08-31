import ExcelJS from 'exceljs';
import { CostSheetVM } from './costSheet.js';

/** Cost sheet as a single-sheet .xlsx workbook. */
export async function costSheetXlsx(vm: CostSheetVM): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RFQ & Cost Estimation System';
  wb.created = new Date();

  const ws = wb.addWorksheet('Cost Sheet');
  ws.columns = [{ width: 46 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 16 }];

  const title = (t: string) => {
    const r = ws.addRow([t]);
    r.font = { bold: true, size: 12 };
  };
  const kv = (k: string, v: unknown) => ws.addRow([k, v as ExcelJS.CellValue]);

  title(`Estimated Cost Sheet — ${vm.quoteNo}`);
  kv('Date', vm.date);
  kv('RFQ / Revision', `${vm.rfqNumber} · R${vm.revisionNo}`);
  kv('Status', vm.status);
  kv('Customer', `${vm.customer.name ?? '—'} (${vm.customer.code ?? '—'})`);
  kv('Part', `${vm.part.number} — ${vm.part.name}`);
  kv('Product type', vm.part.productType ?? '—');
  kv('Quantity', vm.quantity);
  kv('Currency', vm.currency);
  ws.addRow([]);

  if (vm.sourcing === 'BOUGHT_OUT') {
    title('Bought-out component')
    kv('Supplier', vm.supplier ?? '—')
    kv('Purchase price / pc', vm.purchasePricePerPc ?? '—')
  } else {
    title('Material')
    kv('Grade / shape', `${vm.material.grade ?? '—'} / ${vm.material.shape ?? '—'}`)
    kv('Input weight (kg)', vm.material.inputWeightKg ?? '—')
    kv('Rate / kg', vm.material.ratePerKg ?? '—')
  }
  ws.addRow([]);

  title('Process lines');
  const ph = ws.addRow(['Process', 'Type', 'Method', 'Qty/Time', 'Cost / pc']);
  ph.font = { bold: true };
  vm.processes.forEach((p) =>
    ws.addRow([`${p.sequence}. ${p.name}`, p.type, p.method, p.qtyOrTime, p.cost])
  );
  ws.addRow([]);

  title('Cost build-up');
  vm.buildUp.forEach((l) => {
    const r = ws.addRow([l.detail ? `${l.label} (${l.detail})` : l.label, null, null, null, l.amount]);
    if (l.emphasis) r.font = { bold: true };
  });
  const tot = ws.addRow([`Total quote (× ${vm.quantity})`, null, null, null, vm.totalQuote]);
  tot.font = { bold: true };

  // currency formatting on the last column
  ws.getColumn(5).numFmt = '#,##0.00';
  ws.getColumn(4).numFmt = '#,##0.###';

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
