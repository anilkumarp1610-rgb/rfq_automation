import { beforeAll, describe, expect, it } from 'vitest';
import { as, createCustomer, createPart, createRfq, createUser, http, stamp, type TestUser } from '../test-support/helpers.js';

let admin: TestUser;
let estimator: TestUser;
let viewer: TestUser;
const tag = `PG${stamp()}`; // every row this file creates carries the tag, so search isolates them
const N = 5;
let rfqIds: string[] = [];
let partNumbers: string[] = [];

beforeAll(async () => {
  admin = await createUser('ADMIN');
  estimator = await createUser('ESTIMATOR');
  viewer = await createUser('VIEWER');
  const customer = await createCustomer(admin);
  for (let i = 0; i < N; i++) {
    const pn = `${tag}-P${i}`;
    partNumbers.push(pn);
    const part = await createPart(estimator, customer.id, pn);
    rfqIds.push((await createRfq(estimator, part.id)).rfq.id);
  }
});

const total = (res: { headers: Record<string, unknown> }) => Number(res.headers['x-total-count']);

describe('backward compatible: no paging params = the whole list, as before', () => {
  it('returns a plain array and no total header', async () => {
    const res = await as(viewer).get(`/rfqs?search=${tag}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(N);
    expect(res.headers['x-total-count']).toBeUndefined();
  });
});

describe('GET /rfqs — paging', () => {
  it('returns one page of rows plus the full filtered total in X-Total-Count', async () => {
    const res = await as(viewer).get(`/rfqs?search=${tag}&page=1&pageSize=2`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(total(res)).toBe(N);
  });

  it('walks every page with no gaps or duplicates (stable order)', async () => {
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await as(viewer).get(`/rfqs?search=${tag}&page=${page}&pageSize=2&sort=rfqNumber&dir=asc`);
      seen.push(...res.body.map((r: { id: string }) => r.id));
      expect(total(res)).toBe(N);
    }
    expect(seen).toHaveLength(N);
    expect(new Set(seen).size).toBe(N);
    expect(new Set(seen)).toEqual(new Set(rfqIds));
  });

  it('a page past the end is empty but still reports the total', async () => {
    const res = await as(viewer).get(`/rfqs?search=${tag}&page=9&pageSize=2`);
    expect(res.body).toEqual([]);
    expect(total(res)).toBe(N);
  });

  it('the total respects filters', async () => {
    await as(estimator).put(`/rfqs/${rfqIds[0]}`).send({ status: 'COSTED' });
    const res = await as(viewer).get(`/rfqs?search=${tag}&status=COSTED&page=1&pageSize=10`);
    expect(total(res)).toBe(1);
    expect(res.body).toHaveLength(1);
  });

  it('sorts server-side, ascending and descending, across the whole set', async () => {
    const asc = (await as(viewer).get(`/rfqs?search=${tag}&page=1&pageSize=50&sort=rfqNumber&dir=asc`)).body.map((r: { rfqNumber: string }) => r.rfqNumber);
    const desc = (await as(viewer).get(`/rfqs?search=${tag}&page=1&pageSize=50&sort=rfqNumber&dir=desc`)).body.map((r: { rfqNumber: string }) => r.rfqNumber);
    expect(asc).toEqual([...asc].sort());
    expect(desc).toEqual([...asc].reverse());
  });

  it('can sort by a related field (the part number)', async () => {
    const res = await as(viewer).get(`/rfqs?search=${tag}&page=1&pageSize=50&sort=part&dir=desc`);
    const nums = res.body.map((r: { customerPart: { customerPartNumber: string } }) => r.customerPart.customerPartNumber);
    expect(nums).toEqual([...partNumbers].sort().reverse());
  });

  it.each([
    ['page=0&pageSize=10', 'page 0'],
    ['page=-1&pageSize=10', 'a negative page'],
    ['page=abc&pageSize=10', 'a non-numeric page'],
    ['page=1&pageSize=0', 'a zero page size'],
    ['page=1&pageSize=2.5', 'a fractional page size'],
  ])('rejects %s (%s) with 422, not a crash', async (qs) => {
    expect((await as(viewer).get(`/rfqs?${qs}`)).status).toBe(422);
  });

  it('caps a huge page size instead of returning an unbounded response', async () => {
    const res = await as(viewer).get(`/rfqs?search=${tag}&page=1&pageSize=100000`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(200);
  });

  it('an unknown sort field is a clean 4xx, never a 500', async () => {
    const res = await as(viewer).get(`/rfqs?page=1&pageSize=5&sort=passwordHash`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('master data (the generic CRUD factory) — paging', () => {
  const mtag = `PGM${stamp()}`;
  beforeAll(async () => {
    for (let i = 0; i < 5; i++) {
      const r = await as(admin).post('/customers').send({ code: `${mtag}${i}`.slice(0, 50), name: `Zed ${mtag} ${String.fromCharCode(69 - i)}`, rating: 3 });
      expect(r.status).toBe(201);
    }
  });

  it('pages and sorts customers, with the total filtered by search', async () => {
    const res = await as(admin).get(`/customers?search=${mtag}&page=1&pageSize=3&sort=name&dir=asc`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(total(res)).toBe(5);
    const names = res.body.map((c: { name: string }) => c.name);
    expect(names).toEqual([...names].sort());

    const p2 = await as(admin).get(`/customers?search=${mtag}&page=2&pageSize=3&sort=name&dir=asc`);
    expect(p2.body).toHaveLength(2);
  });

  it('works on another master and keeps unpaged behaviour', async () => {
    const paged = await as(admin).get('/processes?page=1&pageSize=1');
    expect(paged.status).toBe(200);
    expect(paged.body.length).toBeLessThanOrEqual(1);
    expect(total(paged)).toBeGreaterThanOrEqual(paged.body.length);
    const all = await as(admin).get('/processes');
    expect(Array.isArray(all.body)).toBe(true);
    expect(all.headers['x-total-count']).toBeUndefined();
  });

  it('an unknown sort column is a clean 4xx, never a 500', async () => {
    const res = await as(admin).get('/customers?page=1&pageSize=5&sort=notAColumn');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('GET /customer-parts — paging', () => {
  it('pages the parts and reports the total', async () => {
    const res = await as(viewer).get(`/customer-parts?search=${tag}&page=1&pageSize=2&sort=customerPartNumber&dir=asc`);
    expect(res.status).toBe(200);
    expect(res.body.map((p: { customerPartNumber: string }) => p.customerPartNumber)).toEqual([...partNumbers].sort().slice(0, 2));
    expect(total(res)).toBe(N);
  });
});

describe('GET /audit-log — paging', () => {
  it('pages the log newest-first with a total; the old ?limit= still works unpaged', async () => {
    const res = await as(admin).get(`/audit-log?entityType=Rfq&page=1&pageSize=3`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(3);
    expect(total(res)).toBeGreaterThanOrEqual(N);
    const dates = res.body.map((r: { createdAt: string }) => r.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());

    const legacy = await as(admin).get('/audit-log?limit=2');
    expect(legacy.body.length).toBeLessThanOrEqual(2);
    expect(legacy.headers['x-total-count']).toBeUndefined();
  });
});

describe('the browser can read the total', () => {
  it('CORS exposes X-Total-Count', async () => {
    const res = await http().get('/health').set('Origin', 'http://localhost:5173');
    expect(String(res.headers['access-control-expose-headers'] ?? '').toLowerCase()).toContain('x-total-count');
  });
});
