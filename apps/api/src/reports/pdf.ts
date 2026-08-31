import PDFDocument from 'pdfkit';
import { CostSheetVM } from './costSheet.js';

function render(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

const money = (vm: CostSheetVM, x: number) =>
  `${vm.currency} ${x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function heading(doc: PDFKit.PDFDocument, vm: CostSheetVM, docTitle: string) {
  doc.fontSize(16).font('Helvetica-Bold').text('RFQ & Cost Estimation System', { continued: false });
  doc.moveDown(0.2);
  doc.fontSize(12).font('Helvetica-Bold').text(docTitle);
  doc.moveDown(0.5);
  doc.fontSize(9).font('Helvetica').fillColor('#444');
  doc.text(`Quote No: ${vm.quoteNo}    Date: ${vm.date}    Valid until: ${vm.validUntil}`);
  doc.text(`RFQ: ${vm.rfqNumber}  ·  Revision R${vm.revisionNo}  ·  Status: ${vm.status}`);
  doc.fillColor('#000');
  doc.moveDown(0.6);

  const left = doc.x;
  doc.fontSize(9).font('Helvetica-Bold').text('Customer', { continued: false });
  doc.font('Helvetica').text(
    `${vm.customer.name ?? '—'} (${vm.customer.code ?? '—'})\nTerms: ${vm.customer.paymentTerms ?? '—'}   Rating: ${vm.customer.rating ?? '—'}`
  );
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').text('Part');
  doc.font('Helvetica').text(
    `${vm.part.number} — ${vm.part.name}\nDrawing: ${vm.part.drawingNo ?? '—'}   Part rev: ${vm.part.revision ?? '—'}   Type: ${vm.part.productType ?? '—'}`
  );
  doc.x = left;
  doc.moveDown(0.6);
}

function row(doc: PDFKit.PDFDocument, cols: string[], widths: number[], opts: { bold?: boolean; rule?: boolean } = {}) {
  const y = doc.y;
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
  let x = doc.page.margins.left;
  cols.forEach((c, i) => {
    doc.text(c, x + 2, y + 3, { width: widths[i] - 4, align: i === 0 ? 'left' : 'right' });
    x += widths[i];
  });
  doc.y = y + 16;
  if (opts.rule) {
    doc
      .moveTo(doc.page.margins.left, doc.y - 2)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y - 2)
      .strokeColor('#ccc')
      .stroke();
  }
}

export function costSheetPdf(vm: CostSheetVM): Promise<Buffer> {
  return render((doc) => {
    heading(doc, vm, 'ESTIMATED COST SHEET');
    const full = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    if (vm.sourcing === 'BOUGHT_OUT') {
      doc.font('Helvetica-Bold').fontSize(10).text('Bought-out component');
      doc.font('Helvetica').fontSize(9).text(
        `Supplier ${vm.supplier ?? '—'} · purchase price ${
          vm.purchasePricePerPc != null ? money(vm, vm.purchasePricePerPc) : '—'
        } / pc`
      );
    } else {
      doc.font('Helvetica-Bold').fontSize(10).text('Material');
      doc.font('Helvetica').fontSize(9).text(
        `Grade ${vm.material.grade ?? '—'} · ${vm.material.shape ?? '—'} · input weight ${vm.material.inputWeightKg ?? '—'} kg` +
          (vm.material.ratePerKg ? ` @ ${money(vm, vm.material.ratePerKg)}/kg` : '')
      );
    }
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(10).text('Process lines');
    doc.moveDown(0.2);
    const pw = [full * 0.32, full * 0.16, full * 0.16, full * 0.18, full * 0.18];
    row(doc, ['Process', 'Type', 'Method', 'Qty/Time', 'Cost/pc'], pw, { bold: true, rule: true });
    if (vm.processes.length === 0) row(doc, ['(none)', '', '', '', ''], pw);
    vm.processes.forEach((p) =>
      row(doc, [`${p.sequence}. ${p.name}`, p.type, p.method, String(p.qtyOrTime), money(vm, p.cost)], pw, {
        rule: true,
      })
    );
    doc.moveDown(0.6);

    doc.font('Helvetica-Bold').fontSize(10).text('Cost build-up');
    doc.moveDown(0.2);
    const bw = [full * 0.72, full * 0.28];
    vm.buildUp.forEach((l) =>
      row(
        doc,
        [l.detail ? `${l.label}  (${l.detail})` : l.label, money(vm, l.amount)],
        bw,
        { bold: l.emphasis, rule: true }
      )
    );
    doc.moveDown(0.4);
    row(doc, [`Total quote  (× ${vm.quantity.toLocaleString('en-IN')} pcs)`, money(vm, vm.totalQuote)], bw, {
      bold: true,
    });

    doc.moveDown(1.5);
    doc.fontSize(7.5).fillColor('#777').font('Helvetica').text(
      'Deterministic estimate from configured master rates. AI assists extraction and reference lookup only; it does not set price. ' +
        (vm.computedAt ? `Computed ${vm.computedAt}.` : '')
    );
  });
}

export function quotationPdf(vm: CostSheetVM): Promise<Buffer> {
  return render((doc) => {
    heading(doc, vm, 'QUOTATION');
    const full = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.moveDown(0.4);
    const w = [full * 0.5, full * 0.16, full * 0.16, full * 0.18];
    row(doc, ['Description', 'Qty', 'Unit price', 'Amount'], w, { bold: true, rule: true });
    row(
      doc,
      [
        `${vm.part.number} — ${vm.part.name}` + (vm.material.grade ? ` (${vm.material.grade})` : ''),
        vm.quantity.toLocaleString('en-IN'),
        money(vm, vm.quotedPricePerPc),
        money(vm, vm.totalQuote),
      ],
      w,
      { rule: true }
    );
    doc.moveDown(0.4);
    row(doc, ['Total', '', '', money(vm, vm.totalQuote)], w, { bold: true });

    doc.moveDown(2);
    doc.fontSize(9).font('Helvetica').fillColor('#000');
    doc.text(`Payment terms: ${vm.customer.paymentTerms ?? 'As agreed'}`);
    doc.text(`Validity: this quotation is valid until ${vm.validUntil}.`);
    doc.text('Prices are per piece, ex-works, exclusive of taxes unless stated.');
    doc.moveDown(2);
    doc.fillColor('#777').fontSize(8).text('Generated by RFQ & Cost Estimation System.');
  });
}
