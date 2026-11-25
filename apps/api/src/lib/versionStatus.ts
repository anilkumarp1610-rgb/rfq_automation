import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Statuses that mean "a quotation went out" (or has since been decided). */
export const QUOTE_STATUSES = new Set(['QUOTED', 'WON', 'LOST']);

/**
 * The ONE place a version's status changes, so every path (editing the version, approving the
 * quotation, marking it won / lost) records the same history:
 *
 *  - `quotedAt`  — set when the version enters QUOTED (or WON / LOST without having been quoted).
 *  - `decidedAt` — set when it enters WON / LOST, cleared if it goes back to DRAFT / COSTED.
 *  - the RFQ header follows when this is the current revision.
 *
 * These timestamps (not `updated_at`, which moves on any edit) drive the dashboard's month buckets.
 * A no-op when the status is unchanged. Returns whether anything changed.
 */
export async function setVersionStatus(tx: Tx, versionId: bigint, status: string, now = new Date()): Promise<boolean> {
  const v = await tx.rfqVersion.findUnique({
    where: { id: versionId },
    select: { status: true, isCurrent: true, rfqId: true, quotedAt: true },
  });
  if (!v || v.status === status) return false;

  const data: Prisma.RfqVersionUpdateInput = { status };
  if (status === 'QUOTED') {
    data.quotedAt = now;
    data.decidedAt = null;
  } else if (status === 'WON' || status === 'LOST') {
    data.decidedAt = now;
    data.quotedAt = v.quotedAt ?? now;
  } else {
    data.decidedAt = null; // back to DRAFT / COSTED
  }
  await tx.rfqVersion.update({ where: { id: versionId }, data });

  if (v.isCurrent && QUOTE_STATUSES.has(status)) {
    await tx.rfq.update({ where: { id: v.rfqId }, data: { status } });
  }
  return true;
}
