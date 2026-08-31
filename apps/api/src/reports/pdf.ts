import PDFDocument from 'pdfkit';
import { CostSheetVM } from './costSheet.js';

type Doc = PDFKit.PDFDocument;
const MARGIN = 48;
const INK = '#1e293b';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const RULE = '#cbd5e1';

function render(build: (doc: Doc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

const contentWidth = (doc: Doc) => doc.page.width - MARGIN * 2;
const rightEdge = (doc: Doc) => doc.page.width - MARGIN;

const money = (vm: CostSheetVM, x: number) =>
  `${vm.currency} ${x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function hr(doc: Doc, color = LINE, width = 0.75) {
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(rightEdge(doc), doc.y)
    .lineWidth(width)
    .strokeColor(color)
    .stroke();
  doc.strokeColor(INK);
}

/** Decode a PNG/JPEG data URI to a Buffer pdfkit can embed; null for anything else. */
function logoBuffer(dataUri: string | null): Buffer | null {
  if (!dataUri) return null;
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/s.exec(dataUri);
  if (!m) return null;
  try {
    return Buffer.from(m[2], 'base64');
  } catch {
    return null;
  }
}

interface Col {
  label: string;
  width: number;
  align?: 'left' | 'right';
}

/** Row-height-aware table. Always leaves `doc.x` at the left margin. */
function table(doc: Doc, cols: Col[], rows: (string | { text: string; bold?: boolean })[][]) {
  const x0 = MARGIN;
  const total = cols.reduce((s, c) => s + c.width, 0);
  const pad = 5;

  const drawRow = (
    cells: (string | { text: string; bold?: boolean })[],
    y: number,
    defaultBold: boolean
  ): number => {
    const norm = cells.map((c) => (typeof c === 'string' ? { text: c, bold: defaultBold } : c));
    let h = 0;
    norm.forEach((c, i) => {
      doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica');
      h = Math.max(h, doc.heightOfString(c.text || ' ', { width: cols[i].width - pad * 2 }));
    });
    h += pad * 2;
    let x = x0;
    norm.forEach((c, i) => {
      doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(c.text, x + pad, y + pad, {
        width: cols[i].width - pad * 2,
        align: cols[i].align ?? 'left',
      });
      x += cols[i].width;
    });
    return h;
  };

  let y = doc.y;
  doc.fontSize(8.5).fillColor(MUTED);
  y += drawRow(
    cols.map((c) => c.label),
    y,
    true
  );
  doc.moveTo(x0, y).lineTo(x0 + total, y).lineWidth(1).strokeColor(INK).stroke();

  doc.fontSize(9).fillColor(INK);
  rows.forEach((r) => {
    const h = drawRow(r, y, false);
    y += h;
    doc.moveTo(x0, y).lineTo(x0 + total, y).lineWidth(0.4).strokeColor(LINE).stroke();
  });

  doc.strokeColor(INK);
  doc.x = x0;
  doc.y = y + 4;
}

/** Right-aligned label / value pairs (totals). */
function totals(doc: Doc, pairs: { label: string; value: string; bold?: boolean }[]) {
  const blockW = 250;
  const x = rightEdge(doc) - blockW;
  pairs.forEach((p) => {
    const y = doc.y;
    doc.fontSize(9).font(p.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(INK);
    doc.text(p.label, x, y + 3, { width: blockW * 0.55, align: 'left' });
    doc.text(p.value, x + blockW * 0.5, y + 3, { width: blockW * 0.5, align: 'right' });
    doc.y = y + 16;
  });
  doc.x = MARGIN;
}

function heading(doc: Doc, vm: CostSheetVM, docTitle: string) {
  const co = vm.company;
  const top = MARGIN;

  const logo = logoBuffer(co?.logo ?? null);
  if (logo) {
    try {
      doc.image(logo, rightEdge(doc) - 130, top, { fit: [130, 54], align: 'right' });
    } catch {
      /* unsupported image */
    }
  }

  doc.y = top;
  doc.x = MARGIN;
  doc
    .fontSize(16)
    .font('Helvetica-Bold')
    .fillColor(INK)
    .text(co?.name ?? 'RFQ & Cost Estimation System', { width: contentWidth(doc) - 150 });
  if (co) {
    doc.fontSize(8).font('Helvetica').fillColor(MUTED);
    if (co.address) doc.text(co.address.replace(/\s*\n\s*/g, ', '), { width: contentWidth(doc) - 150 });
    const contact = [co.phone, co.email, co.website].filter(Boolean).join('   ·   ');
    if (contact) doc.text(contact, { width: contentWidth(doc) - 150 });
    if (co.gstNo) doc.text(`GSTIN: ${co.gstNo}`, { width: contentWidth(doc) - 150 });
  }

  doc.moveDown(0.7);
  hr(doc, RULE, 1);
  doc.moveDown(0.7);

  doc.fontSize(15).font('Helvetica-Bold').fillColor(INK).text(docTitle, { characterSpacing: 1 });
  doc.moveDown(0.25);
  doc.fontSize(8.5).font('Helvetica').fillColor(MUTED);
  doc.text(
    `Quote No: ${vm.quoteNo}      Date: ${vm.date}      Valid until: ${vm.validUntil}      Status: ${vm.status}`
  );
  doc.text(`RFQ: ${vm.rfqNumber}  ·  Revision R${vm.revisionNo}`);
  doc.fillColor(INK);
  doc.moveDown(0.8);

  // Two columns: Bill to | Part
  const colW = (contentWidth(doc) - 20) / 2;
  const startY = doc.y;

  doc.fontSize(8.5).font('Helvetica-Bold').fillColor(MUTED).text('BILL TO', MARGIN, startY);
  doc.fontSize(9).font('Helvetica').fillColor(INK);
  doc.text(`${vm.customer.name ?? '—'} (${vm.customer.code ?? '—'})`, MARGIN, doc.y + 2, {
    width: colW,
  });
  doc.text(`Payment terms: ${vm.customer.paymentTerms ?? '—'}`, { width: colW });
  doc.text(`Customer rating: ${vm.customer.rating ?? '—'}`, { width: colW });
  const leftBottom = doc.y;

  const rx = MARGIN + colW + 20;
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor(MUTED).text('PART', rx, startY);
  doc.fontSize(9).font('Helvetica').fillColor(INK);
  doc.text(`${vm.part.number} — ${vm.part.name}`, rx, doc.y + 2, { width: colW });
  doc.text(
    `Drawing: ${vm.part.drawingNo ?? '—'}   ·   Part rev: ${vm.part.revision ?? '—'}   ·   Type: ${vm.part.productType ?? '—'}`,
    { width: colW }
  );

  doc.x = MARGIN;
  doc.y = Math.max(leftBottom, doc.y) + 14;
}

/** Small stub near the page bottom. */
function footer(doc: Doc, text: string) {
  const y = doc.page.height - MARGIN - 14;
  doc.fontSize(7.5).font('Helvetica').fillColor(MUTED);
  doc.text(text, MARGIN, y, { width: contentWidth(doc), align: 'center' });
  doc.fillColor(INK);
}

export function costSheetPdf(vm: CostSheetVM): Promise<Buffer> {
  return render((doc) => {
    heading(doc, vm, 'ESTIMATED COST SHEET');
    const full = contentWidth(doc);

    doc.fontSize(9.5).font('Helvetica-Bold').fillColor(INK);
    if (vm.sourcing === 'BOUGHT_OUT') {
      doc.text('Bought-out component');
      doc.font('Helvetica').fillColor(MUTED).fontSize(9).text(
        `Supplier: ${vm.supplier ?? '—'}    ·    Purchase price: ${
          vm.purchasePricePerPc != null ? money(vm, vm.purchasePricePerPc) : '—'
        } / pc`
      );
    } else {
      doc.text('Material');
      doc.font('Helvetica').fillColor(MUTED).fontSize(9).text(
        `Grade ${vm.material.grade ?? '—'}  ·  ${vm.material.shape ?? '—'}  ·  input weight ${
          vm.material.inputWeightKg ?? '—'
        } kg` + (vm.material.ratePerKg ? `  @ ${money(vm, vm.material.ratePerKg)}/kg` : '')
      );
    }
    doc.fillColor(INK);
    doc.moveDown(0.8);

    doc.fontSize(9.5).font('Helvetica-Bold').text('Process lines');
    doc.moveDown(0.3);
    table(
      doc,
      [
        { label: 'Process', width: full * 0.34 },
        { label: 'Type', width: full * 0.16 },
        { label: 'Method', width: full * 0.18 },
        { label: 'Qty / time', width: full * 0.14, align: 'right' },
        { label: 'Cost / pc', width: full * 0.18, align: 'right' },
      ],
      vm.processes.length
        ? vm.processes.map((p) => [
            `${p.sequence}. ${p.name}`,
            p.type,
            p.method,
            String(p.qtyOrTime),
            money(vm, p.cost),
          ])
        : [['(no process lines)', '', '', '', '']]
    );
    doc.moveDown(0.6);

    doc.fontSize(9.5).font('Helvetica-Bold').text('Cost build-up');
    doc.moveDown(0.3);
    table(
      doc,
      [
        { label: 'Component', width: full * 0.72 },
        { label: 'Amount', width: full * 0.28, align: 'right' },
      ],
      vm.buildUp.map((l) => [
        { text: l.detail ? `${l.label}  (${l.detail})` : l.label, bold: !!l.emphasis },
        { text: money(vm, l.amount), bold: !!l.emphasis },
      ])
    );
    doc.moveDown(0.3);
    totals(doc, [
      {
        label: `Total quote  (× ${vm.quantity.toLocaleString('en-IN')} pcs)`,
        value: money(vm, vm.totalQuote),
        bold: true,
      },
    ]);

    doc.moveDown(1.2);
    doc.fontSize(7.5).font('Helvetica').fillColor(MUTED).text(
      'Deterministic estimate from configured master rates. AI assists extraction and reference lookup only; it does not set the price.' +
        (vm.computedAt ? `  Computed ${vm.computedAt}.` : ''),
      { width: full }
    );
    footer(doc, vm.company?.name ? `${vm.company.name} — internal cost sheet` : 'Internal cost sheet');
  });
}

export function quotationPdf(vm: CostSheetVM): Promise<Buffer> {
  return render((doc) => {
    heading(doc, vm, 'QUOTATION');
    const full = contentWidth(doc);

    // Line items
    table(
      doc,
      [
        { label: 'Description', width: full * 0.52 },
        { label: 'Qty', width: full * 0.14, align: 'right' },
        { label: 'Unit price', width: full * 0.17, align: 'right' },
        { label: 'Amount', width: full * 0.17, align: 'right' },
      ],
      [
        [
          `${vm.part.number} — ${vm.part.name}` +
            (vm.sourcing === 'BOUGHT_OUT'
              ? vm.supplier
                ? ` (bought-out, ${vm.supplier})`
                : ' (bought-out)'
              : vm.material.grade
                ? ` (${vm.material.grade})`
                : ''),
          vm.quantity.toLocaleString('en-IN'),
          money(vm, vm.quotedPricePerPc),
          money(vm, vm.totalQuote),
        ],
      ]
    );

    doc.moveDown(0.3);
    totals(doc, [
      { label: 'Subtotal', value: money(vm, vm.totalQuote) },
      { label: 'Total', value: money(vm, vm.totalQuote), bold: true },
    ]);
    const totalsBottom = doc.y;

    const terms = [
      `Payment terms: ${vm.customer.paymentTerms ?? 'As agreed'}.`,
      `This quotation is valid until ${vm.validUntil}.`,
      'Prices are per piece, ex-works, and exclusive of taxes unless stated otherwise.',
      'Delivery schedule to be confirmed on order.',
    ];
    const note = vm.company?.footerNote ?? null;

    // --- Terms & conditions + signature — anchored to the bottom of the page ---
    doc.fontSize(9).font('Helvetica');
    const termsBodyH = terms.reduce(
      (s, t) => s + doc.heightOfString(`•  ${t}`, { width: full }),
      0
    );
    const notesBlockH = note ? 22 + doc.heightOfString(note, { width: full }) : 0;
    const signatureH = 78;
    const blockH = 16 + termsBodyH + notesBlockH + 28 + signatureH;

    const footerReserve = 42;
    const bottomLimit = doc.page.height - MARGIN - footerReserve;
    let blockY = bottomLimit - blockH;
    if (blockY < totalsBottom + 16) {
      doc.addPage();
      blockY = Math.max(MARGIN, doc.page.height - MARGIN - footerReserve - blockH);
    }
    doc.y = blockY;

    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(MUTED).text('TERMS & CONDITIONS', MARGIN);
    doc.moveDown(0.2);
    doc.fontSize(9).font('Helvetica').fillColor(INK);
    terms.forEach((t) => doc.text(`•  ${t}`, MARGIN, doc.y, { width: full }));

    if (note) {
      doc.moveDown(0.6);
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(MUTED).text('NOTES', MARGIN);
      doc.moveDown(0.2);
      doc.fontSize(9).font('Helvetica').fillColor(INK).text(note, MARGIN, doc.y, { width: full });
    }

    // Signature block — right aligned
    doc.moveDown(2.2);
    const sigW = 220;
    const sigX = rightEdge(doc) - sigW;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(INK).text(
      `For ${vm.company?.name ?? 'us'}`,
      sigX,
      doc.y,
      { width: sigW, align: 'left' }
    );
    doc.moveDown(2.2);
    doc.moveTo(sigX, doc.y).lineTo(sigX + 170, doc.y).lineWidth(0.75).strokeColor(RULE).stroke();
    doc.strokeColor(INK);
    doc.fontSize(8.5).font('Helvetica').fillColor(MUTED).text('Authorised Signatory', sigX, doc.y + 3, {
      width: sigW,
    });
    doc.x = MARGIN;

    footer(
      doc,
      `${vm.company?.name ?? 'RFQ & Cost Estimation System'}${vm.company?.gstNo ? `  ·  GSTIN ${vm.company.gstNo}` : ''}  ·  Quote ${vm.quoteNo}`
    );
  });
}
