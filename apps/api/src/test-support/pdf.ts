import PDFDocument from 'pdfkit';

export interface DrawingSpec {
  /** printed under "DRAWING NO.:" — omit to leave the label out */
  drawingNo?: string;
  title?: string;
  material?: string;
  /** "mm" prints "ALL DIMENSIONS ARE IN mm." */
  unitsNote?: string;
  rev?: string;
  /** extra loose text anywhere on the sheet */
  extra?: { text: string; x: number; y: number; size?: number }[];
}

/**
 * A small, genuine PDF with a CAD-style title block (label above its value) in the bottom-right corner —
 * real text, so the text-layer reader is exercised end to end without any fixture file or AI call.
 */
export function drawingPdf(d: DrawingSpec): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [1191, 842], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const put = (text: string, x: number, y: number, size = 9) => doc.fontSize(size).text(text, x, y, { lineBreak: false });
    doc.font('Helvetica');
    put('TITLE:', 840, 690);
    put('MATERIAL:', 740, 690);
    put('DRAWING NO.:', 740, 745);
    put('REV.', 1090, 785);
    put('CUSTOMER', 1030, 690);
    if (d.title) put(d.title, 875, 712, 14);
    if (d.material) put(d.material, 750, 712, 14);
    if (d.drawingNo) put(d.drawingNo, 850, 745, 14);
    if (d.rev) put(d.rev, 1130, 785, 10);
    if (d.unitsNote) put(d.unitsNote, 684, 705, 8);
    for (const e of d.extra ?? []) put(e.text, e.x, e.y, e.size);
    doc.end();
  });
}
