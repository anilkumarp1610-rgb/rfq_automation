import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { drawingPdf } from '../test-support/pdf.js';
import { extractFromText, parseNum } from './textExtract.js';
import { joinRuns, readPdfText, type PageText, type Seg } from './textLayer.js';

const read = async (b: Buffer, hint?: { partNumber?: string }) => extractFromText(await readPdfText(b), hint);

describe('parseNum — numbers as drawings print them', () => {
  it.each([
    ['22', 22],
    ['2 1/2', 2.5],
    ['49-1/8', 49.125],
    ['49 1/8', 49.125],
    ['3/16', 0.1875],
    ['.859', 0.859],
    ['1.00', 1],
  ])('%s -> %s', (s, n) => expect(parseNum(s)).toBe(n));
  it.each(['', 'abc', '1/', '2 1/'])('%j is not a number', (s) => expect(parseNum(s)).toBeNull());
});

describe('joinRuns — one phrase split by the CAD exporter', () => {
  const seg = (text: string, x: number, w: number, y = 100, h = 10): Seg => ({ text, x, y, w, h });

  it('joins words that sit a word-space apart', () => {
    const out = joinRuns([seg('AS PER', 100, 30), seg('BOM', 134, 18)]);
    expect(out.map((s) => s.text)).toEqual(['AS PER BOM']);
  });
  it('keeps table cells apart (a wide gap)', () => {
    expect(joinRuns([seg('PART NUMBER', 100, 60), seg('DASH', 170, 25)]).map((s) => s.text)).toEqual(['PART NUMBER', 'DASH']);
  });
  it('never joins text on different lines', () => {
    expect(joinRuns([seg('SHAFT', 100, 30, 100), seg('26 X 84', 100, 30, 112)])).toHaveLength(2);
  });
});

describe('reading a real PDF, end to end', () => {
  it('title, material grade, drawing no., revision and the size in the title', async () => {
    const r = await read(
      await drawingPdf({ title: 'SHAFT OD 22 X 45 LONG', material: 'EN8', drawingNo: 'P01273549', rev: 'R00', unitsNote: 'ARE IN mm.' })
    );
    expect(r.header).toMatchObject({
      drawingNo: 'P01273549',
      itemName: 'SHAFT OD 22 X 45 LONG',
      title: 'SHAFT OD 22 X 45 LONG',
      materialGrade: 'EN8',
      units: 'mm',
      revision: 'R00',
      maxOdMm: 22,
      overallLengthMm: 45,
    });
    expect(r.items.map((i) => [i.itemType, i.nominalValue])).toEqual([
      ['DIAMETER', 22],
      ['LENGTH', 45],
    ]);
  });

  it('two different drawings give two different answers — never one canned set', async () => {
    const a = await read(await drawingPdf({ title: 'SHAFT 26 X 84 LONG', material: 'EN24', drawingNo: 'P01273550' }));
    const b = await read(await drawingPdf({ title: 'BUSH 40 X 60 LONG', material: 'SS316', drawingNo: 'P09999111' }));
    expect(a.header).toMatchObject({ drawingNo: 'P01273550', itemName: 'SHAFT 26 X 84 LONG', materialGrade: 'EN24', maxOdMm: 26, overallLengthMm: 84 });
    expect(b.header).toMatchObject({ drawingNo: 'P09999111', itemName: 'BUSH 40 X 60 LONG', materialGrade: 'SS316', maxOdMm: 40, overallLengthMm: 60 });
  });

  it('"AS PER BOM" is recorded as the material note but is NOT taken as a grade', async () => {
    const r = await read(await drawingPdf({ title: 'SHAFT 26 X 84 LONG', material: 'AS PER BOM', drawingNo: 'P1' + '2345678' }));
    expect(r.header.materialGrade).toBeNull();
    expect(r.header.materialNote).toBe('AS PER BOM');
    expect(r.flags.join(' ')).toMatch(/names no grade/);
  });

  it('an inch drawing is converted to millimetres', async () => {
    const r = await read(
      await drawingPdf({
        title: 'BRUSH HOLDER',
        material: '304L SS',
        drawingNo: 'CB60931',
        extra: [{ text: 'ROUND BAR: 2 1/2" DIA X 49 1/8" LG.', x: 100, y: 100 }],
      })
    );
    expect(r.header).toMatchObject({ units: 'inch', materialGrade: '304L SS', maxOdMm: 63.5, itemName: 'BRUSH HOLDER' });
    expect(r.header.overallLengthMm).toBeCloseTo(1247.78, 1);
    expect(r.flags.join(' ')).toMatch(/converted from inches/);
  });

  it('says what it could not read instead of inventing it', async () => {
    const r = await read(await drawingPdf({ extra: [{ text: 'JUST A NOTE', x: 100, y: 100 }] }));
    expect(r.header.maxOdMm ?? null).toBeNull();
    expect(r.header.materialGrade ?? null).toBeNull();
    const flags = r.flags.join('\n');
    expect(flags).toMatch(/No material or grade/);
    expect(flags).toMatch(/No "diameter × length" size/);
    expect(flags).toMatch(/no AI was used/i);
  });

  it('a PDF with no text layer is refused plainly, not guessed at', async () => {
    const blank = await new Promise<Buffer>((resolve) => {
      // one page, nothing printed — what a scan looks like to a text reader
      const d = new PDFDocument();
      const c: Buffer[] = [];
      d.on('data', (x: Buffer) => c.push(x));
      d.on('end', () => resolve(Buffer.concat(c)));
      d.rect(10, 10, 100, 100).stroke();
      d.end();
    });
    await expect(readPdfText(blank)).rejects.toMatchObject({ status: 422, expose: true, message: expect.stringMatching(/no selectable text/) });
  });

  it('a damaged file is refused plainly', async () => {
    await expect(readPdfText(Buffer.from('%PDF-1.4 not really'))).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/could not be opened/) });
  });
});

describe('the heuristics, on positioned text', () => {
  const page = (segs: Seg[], width = 1191, height = 842): PageText[] => [{ width, height, segs }];
  const s = (text: string, x: number, y: number, h = 9): Seg => ({ text, x, y, w: text.length * h * 0.55, h });

  it('picks the unlabelled part name by size and position, and says it guessed', () => {
    const r = extractFromText(
      page([s('CORP. Neither', 600, 700), s('TOLERANCES', 700, 650), s('BRUSH HOLDER', 990, 700, 14), s('DRAWN', 860, 700), s('CB60931', 1080, 760, 11)]),
      { partNumber: 'B60931' }
    );
    expect(r.header.itemName).toBe('BRUSH HOLDER');
    expect(r.header.drawingNo).toBe('CB60931');
    expect(r.flags.join(' ')).toMatch(/by position/);
    expect(r.flags.join(' ')).toMatch(/title-block corner/);
  });

  it('uses the part number from the file name to choose between two look-alike numbers', () => {
    const r = extractFromText(page([s('CB58865', 921, 770), s('CB60931', 1080, 760)]), { partNumber: 'B58865' });
    expect(r.header.drawingNo).toBe('CB58865');
  });

  it('does not take another label as a value', () => {
    const r = extractFromText(page([s('MATERIAL:', 740, 690), s('TITLE:', 840, 690), s('CUSTOMER', 1030, 690)]));
    expect(r.header.materialGrade ?? null).toBeNull();
    expect(r.header.itemName ?? null).toBeNull();
  });

  it('reads a value written on the same line as its label', () => {
    const r = extractFromText(page([s('MATERIAL: EN19', 100, 100), s('TITLE: GEAR SHAFT 30 X 120 LONG', 100, 130)]));
    expect(r.header.materialGrade).toBe('EN19');
    expect(r.header.itemName).toBe('GEAR SHAFT 30 X 120 LONG');
    expect(r.header.maxOdMm).toBe(30);
  });

  it('a "1/16 X 45°" chamfer is not mistaken for a stock size', () => {
    const r = extractFromText(page([s('TITLE:', 100, 100), s('SHAFT', 100, 115), s('R 1/16 X 45° TYP', 300, 300)]));
    expect(r.header.maxOdMm ?? null).toBeNull();
  });
});
