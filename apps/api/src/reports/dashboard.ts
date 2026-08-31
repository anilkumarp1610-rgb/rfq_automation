import { prisma } from '../lib/prisma.js';

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date) => d.toLocaleString('en-US', { month: 'short' });
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function dashboardSummary() {
  const [rfqCount, partCount, customerCount, rfqs, versions] = await Promise.all([
    prisma.rfq.count(),
    prisma.customerPart.count(),
    prisma.customer.count({ where: { isActive: true } }),
    prisma.rfq.findMany({ select: { id: true, rfqDate: true } }),
    prisma.rfqVersion.findMany({
      include: {
        costSummary: true,
        rfq: { include: { customerPart: { include: { customer: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const withStatus = (st: string) => versions.filter((v) => v.status === st);
  const quoted = withStatus('QUOTED');
  const won = withStatus('WON');
  const lost = withStatus('LOST');
  const decided = won.length + lost.length;

  const pipelineValue = versions
    .filter((v) => v.isCurrent && v.status === 'QUOTED')
    .reduce((s, v) => s + num(v.costSummary?.totalQuote), 0);
  const wonValue = won.reduce((s, v) => s + num(v.costSummary?.totalQuote), 0);

  // last 6 months
  const now = new Date();
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: monthLabel(d) });
  }
  const bucket = (rows: { when: Date }[]) => {
    const m: Record<string, number> = {};
    for (const r of rows) m[monthKey(r.when)] = (m[monthKey(r.when)] ?? 0) + 1;
    return m;
  };
  const rfqM = bucket(rfqs.map((r) => ({ when: r.rfqDate })));
  const quotedM = bucket(
    versions
      .filter((v) => ['QUOTED', 'WON', 'LOST'].includes(v.status))
      .map((v) => ({ when: v.updatedAt }))
  );
  const wonM = bucket(won.map((v) => ({ when: v.updatedAt })));

  const monthly = months.map((m) => ({
    name: m.label,
    rfqs: rfqM[m.key] ?? 0,
    quoted: quotedM[m.key] ?? 0,
    won: wonM[m.key] ?? 0,
  }));

  const recent = versions.slice(0, 8).map((v) => ({
    rfqVersionId: v.id.toString(),
    rfqId: v.rfqId.toString(),
    rfqNumber: v.rfq.rfqNumber,
    revisionNo: v.revisionNo,
    part: v.rfq.customerPart.customerPartNumber,
    customer: v.rfq.customerPart.customer?.code ?? null,
    status: v.status,
    quotedPricePerPc: v.costSummary ? num(v.costSummary.quotedPricePerPc) : null,
    updatedAt: v.updatedAt.toISOString(),
  }));

  return {
    counts: {
      rfqs: rfqCount,
      parts: partCount,
      customers: customerCount,
      quoted: quoted.length,
      won: won.length,
      lost: lost.length,
    },
    winRate: decided ? Number((won.length / decided).toFixed(3)) : null,
    pipelineValue: Number(pipelineValue.toFixed(2)),
    wonValue: Number(wonValue.toFixed(2)),
    monthly,
    recent,
  };
}
