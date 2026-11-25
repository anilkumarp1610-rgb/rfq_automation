import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { as, createUser, http, type TestUser } from '../test-support/helpers.js';
import { drawingPdf } from '../test-support/pdf.js';

/**
 * The internal "Test Drawings" folder: upload drawings, try the extraction on each, compare.
 * Runs with the sample extractor switched on (setup.ts) and no real key, so no paid call is made.
 */
let estimator: TestUser;
let viewer: TestUser;

beforeAll(async () => {
  estimator = await createUser('ESTIMATOR');
  viewer = await createUser('VIEWER');
});

const PDF = Buffer.from('%PDF-1.4\n%fake drawing for tests\n');
const unique = () => `T${Date.now()}${Math.floor(Math.random() * 1000)}`;

const upload = (user: TestUser, files: { name: string; type?: string; data?: Buffer }[]) => {
  let req = as(user).post('/test-drawings');
  for (const f of files) req = req.attach('files', f.data ?? PDF, { filename: f.name, contentType: f.type ?? 'application/pdf' });
  return req;
};

describe('access', () => {
  it('needs a login', async () => {
    expect((await http().get('/test-drawings')).status).toBe(401);
  });

  it.each(['get', 'post'] as const)('is closed to a viewer (%s)', async (method) => {
    expect((await as(viewer)[method]('/test-drawings')).status).toBe(403);
  });

  it('is open to an estimator', async () => {
    const res = await as(estimator).get('/test-drawings');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.files)).toBe(true);
  });
});

describe('upload', () => {
  it('stores several files at once, keeping their names', async () => {
    const a = `${unique()}-A.pdf`;
    const b = `${unique()}-B.pdf`;
    const res = await upload(estimator, [{ name: a }, { name: b }]);
    expect(res.status).toBe(201);
    expect(res.body.saved.sort()).toEqual([a, b].sort());
    expect(res.body.rejected).toEqual([]);

    const list = (await as(estimator).get('/test-drawings')).body.files as { name: string; size: number; analysis: unknown }[];
    const hit = list.find((f) => f.name === a)!;
    expect(hit.size).toBe(PDF.length);
    expect(hit.analysis).toBeNull(); // not analysed until someone asks
  });

  it('never overwrites: the same name again becomes name-2', async () => {
    const n = `${unique()}.pdf`;
    expect((await upload(estimator, [{ name: n }])).body.saved).toEqual([n]);
    expect((await upload(estimator, [{ name: n }])).body.saved).toEqual([n.replace('.pdf', '-2.pdf')]);
  });

  it('reports a file type it does not accept, and saves the others', async () => {
    const ok = `${unique()}.pdf`;
    const res = await upload(estimator, [{ name: ok }, { name: 'notes.txt', type: 'text/plain' }]);
    expect(res.status).toBe(201);
    expect(res.body.saved).toEqual([ok]);
    expect(res.body.rejected).toEqual([{ name: 'notes.txt', reason: expect.stringMatching(/PDF or image/) }]);
  });

  it('answers 422 when nothing could be saved', async () => {
    const res = await upload(estimator, [{ name: 'notes.txt', type: 'text/plain' }]);
    expect(res.status).toBe(422);
    expect(res.body.saved).toEqual([]);
  });

  it('answers 400 when no file is sent', async () => {
    expect((await as(estimator).post('/test-drawings')).status).toBe(400);
  });

  it('makes odd names safe: no folders, no odd characters', async () => {
    const res = await upload(estimator, [{ name: '../../evil name (1).pdf' }]);
    expect(res.status).toBe(201);
    const saved = res.body.saved[0] as string;
    expect(saved).not.toMatch(/[\\/]/);
    expect(saved).toMatch(/\.pdf$/);
    expect(saved.startsWith('.')).toBe(false);
  });
});

describe('analyze and compare', () => {
  it('analyses a file, remembers the result, and shows it in the list', async () => {
    const name = `${unique()}-P01273549.pdf`;
    await upload(estimator, [{ name }]);

    const res = await as(estimator).post(`/test-drawings/${name}/analyze`);
    expect(res.status).toBe(200);
    expect(res.body.mock).toBe(true); // sample stub: no real key in tests
    expect(res.body.header.itemName).toBeTruthy();
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.filenamePart).toBeTruthy();

    const stored = await as(estimator).get(`/test-drawings/${name}/analysis`);
    expect(stored.status).toBe(200);
    expect(stored.body.analyzedAt).toBe(res.body.analyzedAt);

    const row = ((await as(estimator).get('/test-drawings')).body.files as any[]).find((f) => f.name === name);
    expect(row.analysis).toMatchObject({ mock: true, itemName: expect.any(String), itemCount: expect.any(Number) });
    expect((await as(estimator).get('/test-drawings')).body.extraction).toBe('sample');
  });

  it('has no stored analysis until one is run', async () => {
    const name = `${unique()}.pdf`;
    await upload(estimator, [{ name }]);
    expect((await as(estimator).get(`/test-drawings/${name}/analysis`)).status).toBe(404);
  });

  it('refuses — instead of inventing values — when no AI key is set, the sample is off and the PDF has no readable text', async () => {
    const name = `${unique()}.pdf`;
    await upload(estimator, [{ name }]);
    const before = process.env.SPEC_ALLOW_MOCK;
    process.env.SPEC_ALLOW_MOCK = 'false';
    try {
      const res = await as(estimator).post(`/test-drawings/${name}/analyze`);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/not configured.*ANTHROPIC_API_KEY/);
      expect((await as(estimator).get('/test-drawings')).body.extraction).toBe('text');
    } finally {
      process.env.SPEC_ALLOW_MOCK = before;
    }
  });

  it('the wizard preview refuses the same way', async () => {
    const before = process.env.SPEC_ALLOW_MOCK;
    process.env.SPEC_ALLOW_MOCK = 'false';
    try {
      const res = await as(estimator).post('/rfqs/spec-preview').attach('file', PDF, { filename: 'X1.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/not configured/);
    } finally {
      process.env.SPEC_ALLOW_MOCK = before;
    }
  });
});

describe('free text reading (no AI)', () => {
  const sampleOff = async (fn: () => Promise<void>) => {
    const before = process.env.SPEC_ALLOW_MOCK;
    process.env.SPEC_ALLOW_MOCK = 'false';
    try {
      await fn();
    } finally {
      process.env.SPEC_ALLOW_MOCK = before;
    }
  };

  it('with no AI key and the sample off, a text PDF is read from its own text', () =>
    sampleOff(async () => {
      const name = `${unique()}-P01273549.pdf`;
      await upload(estimator, [{ name, data: await drawingPdf({ title: 'SHAFT OD 22 X 45 LONG', material: 'EN8', drawingNo: 'P01273549' }) }]);

      const res = await as(estimator).post(`/test-drawings/${name}/analyze`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        mock: false,
        source: 'text',
        model: null,
        header: { drawingNo: 'P01273549', itemName: 'SHAFT OD 22 X 45 LONG', materialGrade: 'EN8', maxOdMm: 22, overallLengthMm: 45 },
      });
      const list = (await as(estimator).get('/test-drawings')).body;
      expect(list.extraction).toBe('text');
      expect(list.files.find((f: any) => f.name === name).analysis).toMatchObject({ source: 'text', itemName: 'SHAFT OD 22 X 45 LONG', materialGrade: 'EN8' });
    }));

  it('?mode=text reads the text even while the sample is switched on', async () => {
    const name = `${unique()}.pdf`;
    await upload(estimator, [{ name, data: await drawingPdf({ title: 'BUSH 40 X 60 LONG', material: 'SS316', drawingNo: 'P09999111' }) }]);
    const res = await as(estimator).post(`/test-drawings/${name}/analyze?mode=text`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'text', mock: false, header: { itemName: 'BUSH 40 X 60 LONG', maxOdMm: 40 } });
  });

  it('two different PDFs come back different', () =>
    sampleOff(async () => {
      const a = `${unique()}-A.pdf`;
      const b = `${unique()}-B.pdf`;
      await upload(estimator, [
        { name: a, data: await drawingPdf({ title: 'SHAFT 26 X 84 LONG', material: 'EN24', drawingNo: 'P01273550' }) },
        { name: b, data: await drawingPdf({ title: 'BUSH 40 X 60 LONG', material: 'SS316', drawingNo: 'P09999111' }) },
      ]);
      const ra = (await as(estimator).post(`/test-drawings/${a}/analyze`)).body;
      const rb = (await as(estimator).post(`/test-drawings/${b}/analyze`)).body;
      expect(ra.header.itemName).not.toBe(rb.header.itemName);
      expect(ra.header.drawingNo).not.toBe(rb.header.drawingNo);
    }));

  it('a scanned PDF (no text) with no AI is refused with a message that says why', () =>
    sampleOff(async () => {
      const name = `${unique()}.pdf`;
      await upload(estimator, [{ name }]); // the fake PDF has no readable text
      const res = await as(estimator).post(`/test-drawings/${name}/analyze?mode=text`);
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/could not be opened|no selectable text/);
    }));

  it('the wizard preview reads the PDF text too, and reports where the values came from', () =>
    sampleOff(async () => {
      const pdf = await drawingPdf({ title: 'SHAFT 26 X 84 LONG', material: 'EN24', drawingNo: 'P01273550' });
      const res = await as(estimator).post('/rfqs/spec-preview').attach('file', pdf, { filename: 'P01273550.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ source: 'text', mock: false, partName: 'SHAFT 26 X 84 LONG', materialNote: 'EN24' });
    }));
});

describe('view and delete', () => {
  it('serves the stored file back', async () => {
    const name = `${unique()}.pdf`;
    await upload(estimator, [{ name }]);
    const res = await as(estimator).get(`/test-drawings/${name}/file`).buffer(true).parse((r, cb) => {
      const c: Buffer[] = [];
      r.on('data', (d: Buffer) => c.push(d));
      r.on('end', () => cb(null, Buffer.concat(c)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
    expect((res.body as Buffer).equals(PDF)).toBe(true);
  });

  it('deletes the file and its stored analysis', async () => {
    const name = `${unique()}.pdf`;
    await upload(estimator, [{ name }]);
    await as(estimator).post(`/test-drawings/${name}/analyze`);

    expect((await as(estimator).delete(`/test-drawings/${name}`)).status).toBe(204);
    expect((await as(estimator).get(`/test-drawings/${name}/file`)).status).toBe(404);
    expect((await as(estimator).get(`/test-drawings/${name}/analysis`)).status).toBe(404);
    expect((await as(estimator).delete(`/test-drawings/${name}`)).status).toBe(404);
  });

  it('a viewer cannot delete', async () => {
    const name = `${unique()}.pdf`;
    await upload(estimator, [{ name }]);
    expect((await as(viewer).delete(`/test-drawings/${name}`)).status).toBe(403);
    expect((await as(estimator).get(`/test-drawings/${name}/file`)).status).toBe(200);
  });
});

describe('path safety', () => {
  const bad = ['..%2F..%2Fpackage.json', '..%5C..%5Cpackage.json', '%2E%2E%2Fsecret.pdf', 'notes.txt', 'x.exe', '.hidden.pdf'];

  it.each(bad)('rejects the name %s', async (name) => {
    for (const call of [
      as(estimator).get(`/test-drawings/${name}/file`),
      as(estimator).post(`/test-drawings/${name}/analyze`),
      as(estimator).delete(`/test-drawings/${name}`),
    ]) {
      expect([400, 404]).toContain((await call).status);
    }
  });

  it('cannot reach a file outside the test folder, even one that exists', async () => {
    const outside = path.join(process.env.UPLOAD_DIR!, `outside-${unique()}.pdf`);
    fs.writeFileSync(outside, PDF);
    const res = await as(estimator).get(`/test-drawings/..%2F${path.basename(outside)}/file`);
    expect([400, 404]).toContain(res.status);
    expect(fs.existsSync(outside)).toBe(true);
    const del = await as(estimator).delete(`/test-drawings/..%2F${path.basename(outside)}`);
    expect([400, 404]).toContain(del.status);
    expect(fs.existsSync(outside)).toBe(true); // not deleted
  });
});

afterEach(() => {
  process.env.SPEC_ALLOW_MOCK = 'true';
});
