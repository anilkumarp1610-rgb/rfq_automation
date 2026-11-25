import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  as, createCustomer, createPart, createRfq, createUser, getBinary, prisma, stamp, type TestUser,
} from '../test-support/helpers.js';

let admin: TestUser;
let estimator: TestUser;
let viewer: TestUser;
let versionId: string;
let partNumber: string;
let totalQuote: number;
let quotedPricePerPc: number;
let uncostedVersionId: string;

beforeAll(async () => {
  admin = await createUser('ADMIN');
  estimator = await createUser('ESTIMATOR');
  viewer = await createUser('VIEWER');

  const customer = await createCustomer(admin);
  partNumber = `RPT${stamp()}`;
  const part = await createPart(estimator, customer.id, partNumber);
  ({ versionId } = await createRfq(estimator, part.id, { annualQty: 500 }));
  await as(estimator).put(`/rfq-versions/${versionId}`).send({
    partAttributes: { sourcingType: 'BOUGHT_OUT', purchasePricePerPc: 777 },
  });
  const computed = await as(estimator).post(`/rfq-versions/${versionId}/compute`).send({ quantity: 20 });
  totalQuote = computed.body.summary.totalQuote;
  quotedPricePerPc = computed.body.summary.quotedPricePerPc;

  // an RFQ that was never costed
  const p2 = await createPart(estimator, customer.id);
  uncostedVersionId = (await createRfq(estimator, p2.id)).versionId;
});

describe('quotation PDF', () => {
  it('is a well-formed PDF delivered as an attachment, named after the quote', async () => {
    const res = await getBinary(estimator, `/rfq-versions/${versionId}/quotation.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="quotation-.+\.pdf"$/);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.body.subarray(-16).toString()).toContain('%%EOF');
    expect(res.body.length).toBeGreaterThan(1500);
  });

  it('a view-only user gets the quotation', async () => {
    const res = await getBinary(viewer, `/rfq-versions/${versionId}/quotation.pdf`);
    expect(res.status).toBe(200);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('is 404 for an unknown version', async () => {
    expect((await getBinary(estimator, '/rfq-versions/999999999/quotation.pdf')).status).toBe(404);
  });
});

describe('cost-sheet PDF', () => {
  it('is a well-formed PDF for staff, and forbidden to a view-only user', async () => {
    const ok = await getBinary(estimator, `/rfq-versions/${versionId}/cost-sheet.pdf`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('application/pdf');
    expect(ok.body.subarray(0, 5).toString()).toBe('%PDF-');

    expect((await getBinary(viewer, `/rfq-versions/${versionId}/cost-sheet.pdf`)).status).toBe(403);
  });
});

describe('cost-sheet XLSX', () => {
  async function load() {
    const res = await getBinary(estimator, `/rfq-versions/${versionId}/cost-sheet.xlsx`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    const cells: (string | number)[] = [];
    wb.eachSheet((ws) =>
      ws.eachRow((row) =>
        row.eachCell((c) => {
          const v = c.value;
          if (typeof v === 'string' || typeof v === 'number') cells.push(v);
          else if (v && typeof v === 'object' && 'result' in v && typeof v.result === 'number') cells.push(v.result);
        })
      )
    );
    return { wb, cells };
  }

  it('is a readable workbook that carries the part number', async () => {
    const { wb, cells } = await load();
    expect(wb.worksheets.length).toBeGreaterThan(0);
    expect(cells.some((c) => typeof c === 'string' && c.includes(partNumber))).toBe(true);
  });

  it('reports the same numbers the API computed (no drift between screen and export)', async () => {
    const { cells } = await load();
    const nums = cells.filter((c): c is number => typeof c === 'number');
    const has = (n: number) => nums.some((x) => Math.abs(x - n) < 0.01);
    expect(has(777), 'purchase price').toBe(true);
    expect(has(quotedPricePerPc), 'quoted price / pc').toBe(true);
    expect(has(totalQuote), 'total quote').toBe(true);
  });

  it('is forbidden to a view-only user', async () => {
    expect((await getBinary(viewer, `/rfq-versions/${versionId}/cost-sheet.xlsx`)).status).toBe(403);
  });
});

describe('an RFQ that was never costed', () => {
  it.each(['quotation.pdf', 'cost-sheet.pdf', 'cost-sheet.xlsx'])('%s is refused with 409 and says why', async (file) => {
    const res = await getBinary(estimator, `/rfq-versions/${uncostedVersionId}/${file}`);
    expect(res.status).toBe(409);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(JSON.parse(res.body.toString()).error).toMatch(/cost has not been computed/i);
  });

  it('cannot be quoted either', async () => {
    const res = await as(estimator).post(`/rfq-versions/${uncostedVersionId}/quote`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/compute the cost/i);
  });
});

describe('POST /rfq-versions/:id/quote', () => {
  it('approves the quotation: version and RFQ become QUOTED, and a history reference is recorded', async () => {
    const res = await as(estimator).post(`/rfq-versions/${versionId}/quote`).send({});
    expect(res.status).toBeLessThan(300);

    const v = await prisma.rfqVersion.findUnique({ where: { id: BigInt(versionId) }, include: { rfq: true, reference: true } });
    expect(v?.status).toBe('QUOTED');
    expect(v?.rfq.status).toBe('QUOTED');
    expect(v?.reference?.outcome).toBe('QUOTED');
    expect(Number(v?.reference?.quotedPricePerPc)).toBeCloseTo(quotedPricePerPc, 2);
  });

  it('can then be marked WON with an actual cost, and the audit log shows who quoted it', async () => {
    const res = await as(estimator).post(`/rfq-versions/${versionId}/reference`).send({ outcome: 'WON', actualCost: 800 });
    expect(res.status).toBeLessThan(300);
    const ref = await prisma.rfqReference.findUnique({ where: { rfqVersionId: BigInt(versionId) } });
    expect(ref?.outcome).toBe('WON');
    expect(Number(ref?.actualCost)).toBe(800);

    const log = (await as(admin).get(`/audit-log?entityId=${versionId}&limit=50`)).body as { by: { email: string } | null }[];
    expect(log.some((l) => l.by?.email === estimator.email)).toBe(true);
  });

  it('a view-only user cannot approve a quotation', async () => {
    expect((await as(viewer).post(`/rfq-versions/${uncostedVersionId}/quote`).send({})).status).toBe(403);
  });
});

describe('GET /reports/dashboard', () => {
  it('returns the aggregate shape the dashboard renders', async () => {
    const res = await as(viewer).get('/reports/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ rfqs: expect.any(Number) });
    expect(res.body.counts.rfqs).toBeGreaterThan(0);
  });
});
