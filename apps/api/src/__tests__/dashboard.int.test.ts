import { beforeAll, describe, expect, it } from 'vitest';
import { as, createCustomer, createPart, createRfq, createUser, prisma, type TestUser } from '../test-support/helpers.js';

let estimator: TestUser;
let admin: TestUser;
let customerId: string;

beforeAll(async () => {
  admin = await createUser('ADMIN');
  estimator = await createUser('ESTIMATOR');
  customerId = (await createCustomer(admin)).id;
});

const dash = async () => (await as(admin).get('/reports/dashboard')).body;
const monthName = (monthsAgo: number) =>
  new Date(new Date().getFullYear(), new Date().getMonth() - monthsAgo, 1).toLocaleString('en-US', { month: 'short' });

/** A costed bought-out RFQ version (price 1000 → a known, nonzero quote). */
async function costedVersion() {
  const part = await createPart(estimator, customerId);
  const { rfq, versionId } = await createRfq(estimator, part.id);
  await as(estimator).put(`/rfq-versions/${versionId}`).send({ partAttributes: { sourcingType: 'BOUGHT_OUT', purchasePricePerPc: 1000 } });
  const c = await as(estimator).post(`/rfq-versions/${versionId}/compute`).send({ quantity: 10 });
  return { rfq, versionId, totalQuote: c.body.summary.totalQuote as number };
}

const row = (versionId: string) =>
  prisma.rfqVersion.findUniqueOrThrow({ where: { id: BigInt(versionId) }, include: { rfq: true } });

describe('status timestamps', () => {
  it('quoting records quotedAt', async () => {
    const { versionId } = await costedVersion();
    expect((await row(versionId)).quotedAt).toBeNull();
    const before = Date.now();
    await as(estimator).post(`/rfq-versions/${versionId}/quote`).send({});
    const v = await row(versionId);
    expect(v.status).toBe('QUOTED');
    expect(v.quotedAt!.getTime()).toBeGreaterThanOrEqual(before - 2000);
    expect(v.decidedAt).toBeNull();
  });

  it('setting the status to WON / LOST records decidedAt (and quotedAt if it was skipped)', async () => {
    const { versionId } = await costedVersion();
    await as(estimator).put(`/rfq-versions/${versionId}`).send({ status: 'WON' });
    const v = await row(versionId);
    expect(v.decidedAt).not.toBeNull();
    expect(v.quotedAt).not.toBeNull();
  });

  it('moving back out of WON clears decidedAt', async () => {
    const { versionId } = await costedVersion();
    await as(estimator).put(`/rfq-versions/${versionId}`).send({ status: 'WON' });
    await as(estimator).put(`/rfq-versions/${versionId}`).send({ status: 'COSTED' });
    expect((await row(versionId)).decidedAt).toBeNull();
  });
});

describe('"Mark won / lost" (POST /reference) is a real status change', () => {
  it('marking WON updates the version, its RFQ header and the dashboard', async () => {
    const { rfq, versionId, totalQuote } = await costedVersion();
    await as(estimator).post(`/rfq-versions/${versionId}/quote`).send({});
    const before = await dash();

    const res = await as(estimator).post(`/rfq-versions/${versionId}/reference`).send({ outcome: 'WON' });
    expect(res.status).toBeLessThan(300);

    const v = await row(versionId);
    expect(v.status).toBe('WON');
    expect(v.decidedAt).not.toBeNull();
    expect(v.rfq.status).toBe('WON');

    const after = await dash();
    expect(after.counts.won).toBe(before.counts.won + 1);
    expect(after.wonValue - before.wonValue).toBeCloseTo(totalQuote, 1);
    expect(after.winRate).not.toBeNull();
    void rfq;
  });

  it('marking LOST counts against the win rate', async () => {
    const { versionId } = await costedVersion();
    await as(estimator).post(`/rfq-versions/${versionId}/quote`).send({});
    const before = await dash();
    await as(estimator).post(`/rfq-versions/${versionId}/reference`).send({ outcome: 'LOST' });
    const after = await dash();
    expect(after.counts.lost).toBe(before.counts.lost + 1);
    expect((await row(versionId)).status).toBe('LOST');
  });

  it('only recording an actual cost (no outcome) leaves the status alone', async () => {
    const { versionId } = await costedVersion();
    await as(estimator).post(`/rfq-versions/${versionId}/quote`).send({});
    await as(estimator).post(`/rfq-versions/${versionId}/reference`).send({ actualCost: 900 });
    expect((await row(versionId)).status).toBe('QUOTED');
  });
});

describe('dashboard month buckets use when it happened, not when the row was last touched', () => {
  it('a quote made 2 months ago is charted 2 months ago even if edited today', async () => {
    const { versionId } = await costedVersion();
    await as(estimator).post(`/rfq-versions/${versionId}/quote`).send({});

    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const before = await dash();
    // back-date the quote; Prisma bumps updatedAt to "now", which the OLD logic would have charted
    await prisma.rfqVersion.update({ where: { id: BigInt(versionId) }, data: { quotedAt: twoMonthsAgo } });
    const after = await dash();

    const m = (d: { monthly: { name: string; quoted: number }[] }, name: string) => d.monthly.find((x) => x.name === name)!.quoted;
    expect(m(after, monthName(2))).toBe(m(before, monthName(2)) + 1);
    expect(m(after, monthName(0))).toBe(m(before, monthName(0)) - 1); // it left the current month
  });

  it('a win decided last month is charted last month', async () => {
    const { versionId } = await costedVersion();
    await as(estimator).post(`/rfq-versions/${versionId}/quote`).send({});
    await as(estimator).post(`/rfq-versions/${versionId}/reference`).send({ outcome: 'WON' });

    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const before = await dash();
    await prisma.rfqVersion.update({ where: { id: BigInt(versionId) }, data: { decidedAt: lastMonth } });
    const after = await dash();

    const w = (d: { monthly: { name: string; won: number }[] }, name: string) => d.monthly.find((x) => x.name === name)!.won;
    expect(w(after, monthName(1))).toBe(w(before, monthName(1)) + 1);
    expect(w(after, monthName(0))).toBe(w(before, monthName(0)) - 1);
  });
});
