import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The model is faked: these tests check what we ASK for and how we treat the answer, never the model itself.
const create = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create };
    static APIError = class extends Error {};
  }
  return { default: Anthropic };
});

import PDFDocument from 'pdfkit';
import { drawingPdf } from '../test-support/pdf.js';
import { aiConfigured, analyzeDrawing, extractionMode, mockAllowed, sourceFromUpload } from './analyze.js';
import { SPEC_SYSTEM_PROMPT } from './prompt.js';

const PDF = Buffer.from('%PDF-1.4 fake');
const reply = (json: unknown, extra: Record<string, unknown> = {}) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }],
  usage: { input_tokens: 1200, output_tokens: 340 },
  ...extra,
});

beforeEach(() => {
  create.mockReset();
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-' + 'x'.repeat(40));
  vi.stubEnv('SPEC_ALLOW_MOCK', '');
  vi.stubEnv('SPEC_EXTRACTOR', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('which extractor runs', () => {
  it.each([
    ['a real-looking key', 'sk-ant-api03-' + 'x'.repeat(40), true],
    ['the .env.example placeholder', 'sk-ant-', false],
    ['an empty key', '', false],
    ['a key of the wrong shape', 'abcdefghijklmnop', false],
  ])('%s -> configured: %s', (_n, key, expected) => {
    vi.stubEnv('ANTHROPIC_API_KEY', key);
    expect(aiConfigured()).toBe(expected);
  });

  it('the sample stub is off unless explicitly switched on', () => {
    expect(mockAllowed()).toBe(false);
    vi.stubEnv('SPEC_ALLOW_MOCK', 'true');
    expect(mockAllowed()).toBe(true);
    vi.stubEnv('SPEC_ALLOW_MOCK', '1'); // only the exact word counts — no accidental opt-in
    expect(mockAllowed()).toBe(false);
  });

  it('with no usable key it REFUSES (503, message shown to the user) instead of inventing a drawing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-');
    await expect(analyzeDrawing(PDF, 'application/pdf')).rejects.toMatchObject({
      status: 503,
      expose: true,
      message: expect.stringMatching(/not configured.*ANTHROPIC_API_KEY/),
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('with no key but the sample switched on it returns the clearly-marked stub, without a model call', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-');
    vi.stubEnv('SPEC_ALLOW_MOCK', 'true');
    const r = await analyzeDrawing(PDF, 'application/pdf');
    expect(r.mock).toBe(true);
    expect(r.header.itemName).toMatch(/mock/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('a real key always goes to the model, even when the sample is switched on', async () => {
    vi.stubEnv('SPEC_ALLOW_MOCK', 'true');
    create.mockResolvedValue(reply({ header: { drawingNo: 'CB60931' }, items: [], flags: [] }));
    const r = await analyzeDrawing(PDF, 'application/pdf');
    expect(r.mock).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('what the model is asked', () => {
  it('asks for the item name, the material grade and the units — and for inches to be converted', () => {
    expect(SPEC_SYSTEM_PROMPT).toMatch(/"itemName"/);
    expect(SPEC_SYSTEM_PROMPT).toMatch(/"materialGrade"/);
    expect(SPEC_SYSTEM_PROMPT).toMatch(/"units"/);
    expect(SPEC_SYSTEM_PROMPT).toMatch(/25\.4/);
    expect(SPEC_SYSTEM_PROMPT).toMatch(/BRUSH HOLDER/);
    expect(SPEC_SYSTEM_PROMPT).toMatch(/304L SS/);
  });

  it('forbids reusing values from another drawing', () => {
    expect(SPEC_SYSTEM_PROMPT).toMatch(/Never reuse values/i);
  });

  it('sends the actual file bytes as a PDF document block', async () => {
    create.mockResolvedValue(reply({ header: {}, items: [], flags: [] }));
    await analyzeDrawing(PDF, 'application/pdf');
    const body = create.mock.calls[0][0];
    expect(body.system).toBe(SPEC_SYSTEM_PROMPT);
    const doc = body.messages[0].content[0];
    expect(doc).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
    expect(doc.source.data).toBe(PDF.toString('base64'));
  });

  it('sends an image as an image block', async () => {
    create.mockResolvedValue(reply({ header: {}, items: [], flags: [] }));
    await analyzeDrawing(Buffer.from('png'), 'image/png');
    expect(create.mock.calls[0][0].messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } });
  });

  it('two different files produce two different requests', async () => {
    create.mockResolvedValue(reply({ header: {}, items: [], flags: [] }));
    await analyzeDrawing(Buffer.from('drawing one'), 'application/pdf');
    await analyzeDrawing(Buffer.from('drawing two'), 'application/pdf');
    const data = create.mock.calls.map((c) => c[0].messages[0].content[0].source.data);
    expect(data[0]).not.toBe(data[1]);
  });

  it('rejects an unsupported file type before spending anything', async () => {
    await expect(analyzeDrawing(Buffer.from('x'), 'text/plain')).rejects.toMatchObject({ status: 415 });
    expect(() => sourceFromUpload(Buffer.from('x'), 'application/zip')).toThrow(/Unsupported file type/);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('what comes back', () => {
  it('returns exactly what the model read for THIS drawing — item name, grade and inch drawings included', async () => {
    create.mockResolvedValue(
      reply({
        header: {
          drawingNo: 'CB60931',
          title: 'BRUSH HOLDER',
          itemName: 'BRUSH HOLDER',
          customerName: 'CONSARC CORP',
          materialGrade: '304L SS',
          units: 'inch',
          maxOdMm: 63.5,
          overallLengthMm: 1247.8,
        },
        items: [{ itemType: 'DIAMETER', label: '2 1/2" DIA', nominalValue: 63.5, unit: 'mm', rawText: '2 1/2" DIA', confidence: 0.9 }],
        flags: [],
      })
    );
    const r = await analyzeDrawing(PDF, 'application/pdf');
    expect(r).toMatchObject({
      mock: false,
      header: { drawingNo: 'CB60931', itemName: 'BRUSH HOLDER', materialGrade: '304L SS', units: 'inch', maxOdMm: 63.5 },
    });
    expect(r.items[0].nominalValue).toBe(63.5);
  });

  it('reports the model and its token usage, so the test page can show what a call cost', async () => {
    create.mockResolvedValue(reply({ header: {}, items: [], flags: [] }));
    const r = await analyzeDrawing(PDF, 'application/pdf');
    expect(r.usage).toEqual({ inputTokens: 1200, outputTokens: 340 });
    expect(r.model).toBeTruthy();
  });

  it('still reads an older-style answer that has no itemName / materialGrade / units', async () => {
    create.mockResolvedValue(reply({ header: { drawingNo: 'X1', title: 'SHAFT', materialNote: 'EN8' }, items: [], flags: [] }));
    const r = await analyzeDrawing(PDF, 'application/pdf');
    expect(r.header.title).toBe('SHAFT');
    expect(r.header.itemName ?? null).toBeNull();
  });

  it('copes with the JSON being wrapped in prose or fences', async () => {
    create.mockResolvedValue(reply('Here you go:\n```json\n{"header":{"drawingNo":"A1"},"items":[],"flags":["check material"]}\n```'));
    const r = await analyzeDrawing(PDF, 'application/pdf');
    expect(r.header.drawingNo).toBe('A1');
    expect(r.flags).toEqual(['check material']);
  });

  it('turns a refusal, a cut-off answer and a schema mismatch into clear, user-visible 502s', async () => {
    create.mockResolvedValueOnce(reply('', { stop_reason: 'refusal' }));
    await expect(analyzeDrawing(PDF, 'application/pdf')).rejects.toMatchObject({ status: 502, expose: true, message: expect.stringMatching(/declined/) });

    create.mockResolvedValueOnce(reply('{"header":', { stop_reason: 'max_tokens' }));
    await expect(analyzeDrawing(PDF, 'application/pdf')).rejects.toMatchObject({ status: 502, expose: true, message: expect.stringMatching(/cut off/) });

    create.mockResolvedValueOnce(reply({ header: { maxOdMm: 'not a number' }, items: [{ itemType: 'BOGUS' }] }));
    await expect(analyzeDrawing(PDF, 'application/pdf')).rejects.toMatchObject({ status: 502, expose: true, message: expect.stringMatching(/schema/) });
  });
});

describe('reading the PDF text — free, no AI', () => {
  const noKey = () => vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-');
  const pdf = (title: string) => drawingPdf({ title, material: 'EN8', drawingNo: 'P01273549' });
  const blankPdf = () =>
    new Promise<Buffer>((resolve) => {
      const d = new PDFDocument();
      const c: Buffer[] = [];
      d.on('data', (x: Buffer) => c.push(x));
      d.on('end', () => resolve(Buffer.concat(c)));
      d.rect(10, 10, 50, 50).stroke();
      d.end();
    });

  it('with no AI key, a text PDF is read from its own text — and labelled as such', async () => {
    noKey();
    const r = await analyzeDrawing(await pdf('SHAFT 26 X 84 LONG'), 'application/pdf');
    expect(r).toMatchObject({ source: 'text', mock: false, header: { itemName: 'SHAFT 26 X 84 LONG', materialGrade: 'EN8', maxOdMm: 26 } });
    expect(r.model).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('two different PDFs give two different results (the original complaint)', async () => {
    noKey();
    const a = await analyzeDrawing(await pdf('SHAFT 26 X 84 LONG'), 'application/pdf');
    const b = await analyzeDrawing(await pdf('BUSH 40 X 60 LONG'), 'application/pdf');
    expect(a.header.itemName).not.toBe(b.header.itemName);
    expect(a.header.maxOdMm).not.toBe(b.header.maxOdMm);
  });

  it('SPEC_EXTRACTOR=text reads the text even when a real key is set — no paid call', async () => {
    vi.stubEnv('SPEC_EXTRACTOR', 'text');
    const r = await analyzeDrawing(await pdf('SHAFT 26 X 84 LONG'), 'application/pdf');
    expect(r.source).toBe('text');
    expect(create).not.toHaveBeenCalled();
  });

  it('a per-call text-only request does the same', async () => {
    const r = await analyzeDrawing(await pdf('SHAFT 26 X 84 LONG'), 'application/pdf', undefined, { textOnly: true });
    expect(r.source).toBe('text');
    expect(create).not.toHaveBeenCalled();
  });

  it('with a real key and no override it still goes to the model', async () => {
    create.mockResolvedValue(reply({ header: {}, items: [], flags: [] }));
    const r = await analyzeDrawing(await pdf('SHAFT 26 X 84 LONG'), 'application/pdf');
    expect(r.source).toBe('ai');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('the sample, when switched on, still wins over text reading (tests and demos stay predictable)', async () => {
    noKey();
    vi.stubEnv('SPEC_ALLOW_MOCK', 'true');
    expect((await analyzeDrawing(await pdf('SHAFT 26 X 84 LONG'), 'application/pdf')).source).toBe('sample');
  });

  it('a scan (no text) with no key is refused, and the message says why text reading could not help', async () => {
    noKey();
    await expect(analyzeDrawing(await blankPdf(), 'application/pdf')).rejects.toMatchObject({
      status: 503,
      expose: true,
      message: expect.stringMatching(/not configured.*no selectable text/s),
    });
  });

  it('a forced text read of a scan says so (422), and an image is refused (415)', async () => {
    await expect(analyzeDrawing(await blankPdf(), 'application/pdf', undefined, { textOnly: true })).rejects.toMatchObject({ status: 422 });
    await expect(analyzeDrawing(Buffer.from('png'), 'image/png', undefined, { textOnly: true })).rejects.toMatchObject({ status: 415 });
  });

  it('an image with no key is refused as not configured — it has no text layer to read', async () => {
    noKey();
    await expect(analyzeDrawing(Buffer.from('png'), 'image/png')).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/images cannot be read/) });
  });

  it('reports which reader will run', () => {
    expect(extractionMode()).toBe('live');
    vi.stubEnv('SPEC_EXTRACTOR', 'text');
    expect(extractionMode()).toBe('text');
    vi.stubEnv('SPEC_EXTRACTOR', '');
    noKey();
    expect(extractionMode()).toBe('text');
    vi.stubEnv('SPEC_ALLOW_MOCK', 'true');
    expect(extractionMode()).toBe('sample');
  });
});
