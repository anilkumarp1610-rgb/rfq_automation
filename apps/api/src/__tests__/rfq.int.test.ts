import { beforeAll, describe, expect, it } from 'vitest';
import {
  as, createCustomer, createPart, createRfq, createUser, prisma, stamp, type TestUser,
} from '../test-support/helpers.js';

let admin: TestUser;
let estimator: TestUser;
let customerId: string;

beforeAll(async () => {
  admin = await createUser('ADMIN');
  estimator = await createUser('ESTIMATOR');
  customerId = (await createCustomer(admin)).id;
});

const seq = (rfqNumber: string) => parseInt(rfqNumber.split('/')[2], 10);

describe('POST /rfqs', () => {
  it('creates the RFQ with revision 1 as the current draft, numbered YYYY/MM/NNNN', async () => {
    const part = await createPart(estimator, customerId);
    const { rfq } = await createRfq(estimator, part.id);

    expect(rfq.rfqNumber).toMatch(/^\d{4}\/\d{2}\/\d{4}$/);
    const year = new Date().getFullYear().toString();
    expect(rfq.rfqNumber.startsWith(`${year}/`)).toBe(true);
    expect(rfq.versions).toHaveLength(1);
    expect(rfq.versions[0]).toMatchObject({ revisionNo: 1, isCurrent: true, status: 'DRAFT' });
  });

  it('auto-numbers on a running counter', async () => {
    const part = await createPart(estimator, customerId);
    const a = (await createRfq(estimator, part.id)).rfq;
    const b = (await createRfq(estimator, part.id)).rfq;
    expect(seq(b.rfqNumber)).toBe(seq(a.rfqNumber) + 1);
  });

  it('honours an explicit RFQ number and rejects a duplicate (409)', async () => {
    const part = await createPart(estimator, customerId);
    const rfqNumber = `EXPLICIT-${stamp()}`;
    const ok = await as(estimator).post('/rfqs').send({ customerPartId: part.id, rfqNumber });
    expect(ok.status).toBe(201);
    expect(ok.body.rfqNumber).toBe(rfqNumber);
    const dup = await as(estimator).post('/rfqs').send({ customerPartId: part.id, rfqNumber });
    expect(dup.status).toBe(409);
  });

  it('404s for an unknown customer part and 422s for a missing one', async () => {
    expect((await as(estimator).post('/rfqs').send({ customerPartId: '999999999' })).status).toBe(404);
    expect((await as(estimator).post('/rfqs').send({})).status).toBe(422);
  });
});

describe('revisions — POST /rfqs/:id/versions', () => {
  it('increments the revision number and keeps exactly one current version', async () => {
    const part = await createPart(estimator, customerId);
    const { rfq } = await createRfq(estimator, part.id);

    const v2 = await as(estimator).post(`/rfqs/${rfq.id}/versions`).send({ versionLabel: 'Rev B' });
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({ revisionNo: 2, isCurrent: true, versionLabel: 'Rev B' });
    const v3 = await as(estimator).post(`/rfqs/${rfq.id}/versions`).send({});
    expect(v3.body.revisionNo).toBe(3);

    const list = (await as(estimator).get(`/rfqs/${rfq.id}/versions`)).body as {
      revisionNo: number;
      isCurrent: boolean;
    }[];
    expect(list.map((v) => v.revisionNo)).toEqual([1, 2, 3]);
    expect(list.filter((v) => v.isCurrent).map((v) => v.revisionNo)).toEqual([3]);
  });

  it('can copy part attributes from an earlier version', async () => {
    const part = await createPart(estimator, customerId);
    const { rfq, versionId } = await createRfq(estimator, part.id);

    const upd = await as(estimator)
      .put(`/rfq-versions/${versionId}`)
      .send({ partAttributes: { surfaceFinish: 'ZINC-PLATED', hardness: '45 HRC', netWeightKg: 1.25 } });
    expect(upd.status).toBe(200);

    const v2 = await as(estimator).post(`/rfqs/${rfq.id}/versions`).send({ copyFromVersionId: versionId });
    expect(v2.status).toBe(201);
    expect(v2.body.partAttributes).toMatchObject({ surfaceFinish: 'ZINC-PLATED', hardness: '45 HRC' });
    expect(Number(v2.body.partAttributes.netWeightKg)).toBeCloseTo(1.25);
  });

  it('makeCurrent flips the current flag back to an older revision, atomically', async () => {
    const part = await createPart(estimator, customerId);
    const { rfq, versionId: v1 } = await createRfq(estimator, part.id);
    await as(estimator).post(`/rfqs/${rfq.id}/versions`).send({});

    expect((await as(estimator).put(`/rfq-versions/${v1}`).send({ makeCurrent: true })).status).toBe(200);
    const rows = await prisma.rfqVersion.findMany({ where: { rfqId: BigInt(rfq.id) }, orderBy: { revisionNo: 'asc' } });
    expect(rows.map((r) => r.isCurrent)).toEqual([true, false]);
  });

  it('404s for an unknown RFQ and 400s for a malformed id', async () => {
    expect((await as(estimator).post('/rfqs/999999999/versions').send({})).status).toBe(404);
    expect((await as(estimator).get('/rfqs/not-a-number')).status).toBe(400);
  });
});

describe('part-attribute references are real foreign keys', () => {
  it('rejects an unknown material grade / shape / product type with a clear 422, changing nothing', async () => {
    const part = await createPart(estimator, customerId);
    const { versionId } = await createRfq(estimator, part.id);
    for (const [field, label] of [
      ['materialCategoryId', /material grade/i],
      ['materialShapeId', /material shape/i],
      ['productTypeId', /product type/i],
    ] as const) {
      const res = await as(estimator).put(`/rfq-versions/${versionId}`).send({ partAttributes: { [field]: '999999999', hardness: 'SHOULD-NOT-SAVE' } });
      expect(res.status, field).toBe(422);
      expect(res.body.error).toMatch(label);
    }
    const attrs = await prisma.rfqPartAttributes.findUnique({ where: { rfqVersionId: BigInt(versionId) } });
    expect(attrs?.hardness).toBeNull();
  });

  it('the database itself refuses a dangling reference (the constraint exists, not just the API check)', async () => {
    const part = await createPart(estimator, customerId);
    const { versionId } = await createRfq(estimator, part.id);
    await expect(
      prisma.rfqPartAttributes.update({ where: { rfqVersionId: BigInt(versionId) }, data: { materialCategoryId: 999999999n } })
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('accepts a valid reference and clears it again with null', async () => {
    const pt = await prisma.productType.create({ data: { name: `ITest PT ${stamp()}` } });
    const part = await createPart(estimator, customerId);
    const { versionId } = await createRfq(estimator, part.id);
    const set = await as(estimator).put(`/rfq-versions/${versionId}`).send({ partAttributes: { productTypeId: pt.id.toString() } });
    expect(set.status).toBe(200);
    expect(set.body.partAttributes.productTypeId).toBe(pt.id.toString());
    const cleared = await as(estimator).put(`/rfq-versions/${versionId}`).send({ partAttributes: { productTypeId: null } });
    expect(cleared.status).toBe(200);
    expect(cleared.body.partAttributes.productTypeId).toBeNull();
  });
});

describe('header updates and listing', () => {
  it('updates the header and filters the list by status and search text', async () => {
    const partNumber = `FILT${stamp()}`;
    const part = await createPart(estimator, customerId, partNumber);
    const { rfq } = await createRfq(estimator, part.id);

    const upd = await as(estimator).put(`/rfqs/${rfq.id}`).send({ annualQty: 5000, status: 'COSTED' });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe('COSTED');

    const bySearch = (await as(estimator).get(`/rfqs?search=${partNumber}`)).body as { id: string }[];
    expect(bySearch.map((r) => r.id)).toContain(rfq.id);
    const wrongStatus = (await as(estimator).get(`/rfqs?search=${partNumber}&status=DRAFT`)).body as { id: string }[];
    expect(wrongStatus.map((r) => r.id)).not.toContain(rfq.id);
  });
});

describe('create RFQ from a drawing (wizard) — mock extraction', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  const rand = () => Math.random().toString(36).slice(2, 10).toUpperCase();

  async function preview(filename: string) {
    return as(estimator).post('/rfqs/spec-preview').attach('file', pdf, { filename, contentType: 'application/pdf' });
  }
  async function fromSpec(filename: string, payload: Record<string, unknown>) {
    return as(estimator)
      .post('/rfqs/from-spec')
      .field('payload', JSON.stringify(payload))
      .attach('file', pdf, { filename, contentType: 'application/pdf' });
  }

  it('previews: reads the part number from the file name and flags the result as mock', async () => {
    const part = `ZX${stamp()}`;
    const res = await preview(`${part}.pdf`);
    expect(res.status).toBe(200);
    expect(res.body.mock).toBe(true);
    expect(res.body.aiConfigured).toBe(false); // the suite never calls the paid API
    expect(res.body.partNumber).toBe(part);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.existing).toBeNull(); // brand-new part: nothing written yet
    expect(await prisma.customerPart.count({ where: { customerPartNumber: part } })).toBe(0);
  });

  it('rejects a missing file and an unsupported file type', async () => {
    expect((await as(estimator).post('/rfqs/spec-preview')).status).toBe(400);
    const txt = await as(estimator)
      .post('/rfqs/spec-preview')
      .attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(txt.status).toBe(400);
  });

  it('creates customer + part + RFQ + spec + draft cost; then asks before adding a revision', async () => {
    const partNumber = `ZY${stamp()}`;
    const filename = `${partNumber}.pdf`;
    const extract = (await preview(filename)).body.extract;
    const payload = {
      extract,
      mock: true,
      partNumber,
      partName: 'Wizard test part',
      revision: 'R00',
      sourcingType: 'BOUGHT_OUT', // no material setup needed for this flow test
      purchasePricePerPc: 500,
      newCustomerName: `${rand()}${stamp()} Wizard Ltd`,
      annualQty: 100,
      batchQty: 50,
    };

    // 1st run: everything is created
    const first = await fromSpec(filename, payload);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ revisionNo: 1, isNewRevision: false, createdCustomer: true, createdPart: true });
    expect(first.body.rfqNumber).toMatch(/^\d{4}\/\d{2}\/\d{4}$/);
    expect(first.body.costSummary.materialCost).toBe(500); // bought-out: purchase price is the base
    expect(first.body.spec.items.length).toBeGreaterThan(0);

    // it is a real, readable RFQ, costed to COSTED
    const read = await as(estimator).get(`/rfq-versions/${first.body.versionId}`);
    expect(read.status).toBe(200);
    expect(read.body.status).toBe('COSTED');
    expect(read.body.attachments).toHaveLength(1);

    // 2nd run, same part, no confirmation: refused and nothing is added
    const before = await prisma.rfqVersion.count({ where: { rfqId: BigInt(first.body.rfqId) } });
    const second = await fromSpec(filename, payload);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ needsRevisionConfirm: true, rfqNumber: first.body.rfqNumber });
    expect(await prisma.rfqVersion.count({ where: { rfqId: BigInt(first.body.rfqId) } })).toBe(before);

    // 3rd run, confirmed: becomes revision 2 of the SAME rfq, and is the only current one
    const third = await fromSpec(filename, { ...payload, confirmRevision: true });
    expect(third.status).toBe(201);
    expect(third.body).toMatchObject({ revisionNo: 2, isNewRevision: true, rfqId: first.body.rfqId, createdPart: false });
    const flags = (await prisma.rfqVersion.findMany({ where: { rfqId: BigInt(first.body.rfqId) }, orderBy: { revisionNo: 'asc' } })).map((v) => v.isCurrent);
    expect(flags).toEqual([false, true]);
  });

  it('reuses a customer with the same name, and gives different names with a shared prefix distinct codes', async () => {
    const tag = rand();
    const mk = async (name: string) => {
      const partNumber = `ZW${stamp()}`;
      const extract = (await preview(`${partNumber}.pdf`)).body.extract;
      return fromSpec(`${partNumber}.pdf`, {
        extract, mock: true, partNumber, partName: 'p', sourcingType: 'BOUGHT_OUT', purchasePricePerPc: 10,
        newCustomerName: name,
      });
    };
    // first 12 alphanumerics are identical ("<tag>SPARKLI" + ...) so the derived codes would collide
    const a = await mk(`${tag}Sparkline Equipments (P) Ltd`);
    const again = await mk(`${tag}Sparkline Equipments (P) Ltd`);
    const other = await mk(`${tag}Sparkline Equipments Pvt`);
    expect([a.status, again.status, other.status]).toEqual([201, 201, 201]);
    expect(a.body.createdCustomer).toBe(true);
    expect(again.body.createdCustomer).toBe(false); // reused by name
    expect(other.body.createdCustomer).toBe(true); // a different customer despite the shared prefix

    const codes = await prisma.customer.findMany({ where: { name: { startsWith: tag } }, select: { code: true } });
    expect(codes).toHaveLength(2);
    expect(new Set(codes.map((c) => c.code)).size).toBe(2);
  });

  it('requires an existing or new customer (400)', async () => {
    const partNumber = `ZZ${stamp()}`;
    const filename = `${partNumber}.pdf`;
    const extract = (await preview(filename)).body.extract;
    const res = await fromSpec(filename, { extract, mock: true, partNumber, partName: 'No customer' });
    expect(res.status).toBe(400);
  });

  it('rejects a bad payload (422)', async () => {
    const res = await fromSpec('P1.pdf', { partNumber: '' });
    expect(res.status).toBe(422);
  });
});
