import { prisma } from './prisma.js';

const pad4 = (n: number) => String(n).padStart(4, '0');

/**
 * Next RFQ number in `YYYY/MM/NNNN` — NNNN is a running counter that resets to
 * 0001 when the year rolls over (the month segment is display-only).
 * The `rfq_number` column is unique, so a rare concurrent collision is retried
 * by the caller.
 */
export async function nextRfqNumber(now = new Date()): Promise<string> {
  const year = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const rows = await prisma.rfq.findMany({
    where: { rfqNumber: { startsWith: `${year}/` } },
    select: { rfqNumber: true },
  });
  const max = rows.reduce((m, r) => {
    const n = parseInt(r.rfqNumber.split('/')[2] ?? '', 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${year}/${mm}/${pad4(max + 1)}`;
}

/** Run `fn` with a fresh RFQ number, retrying on a unique-collision. */
export async function withRfqNumber<T>(fn: (rfqNumber: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn(await nextRfqNumber());
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'P2002' && attempt < 3) continue;
      throw e;
    }
  }
  throw new Error('Could not allocate an RFQ number');
}
