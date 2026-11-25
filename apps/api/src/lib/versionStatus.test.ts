import { describe, expect, it, vi } from 'vitest';
import { QUOTE_STATUSES, setVersionStatus } from './versionStatus.js';

const NOW = new Date('2026-11-19T10:00:00Z');
const EARLIER = new Date('2026-10-01T09:00:00Z');

type V = { status: string; isCurrent: boolean; rfqId: bigint; quotedAt: Date | null } | null;

/** A fake transaction recording the writes setVersionStatus makes. */
function fakeTx(version: V) {
  const tx = {
    rfqVersion: { findUnique: vi.fn().mockResolvedValue(version), update: vi.fn().mockResolvedValue({}) },
    rfq: { update: vi.fn().mockResolvedValue({}) },
  };
  return tx;
}
const run = (tx: ReturnType<typeof fakeTx>, status: string) => setVersionStatus(tx as never, 7n, status, NOW);
const versionWrite = (tx: ReturnType<typeof fakeTx>) => tx.rfqVersion.update.mock.calls[0]?.[0]?.data;

const v = (over: Partial<NonNullable<V>> = {}): NonNullable<V> => ({
  status: 'COSTED', isCurrent: true, rfqId: 3n, quotedAt: null, ...over,
});

describe('QUOTE_STATUSES', () => {
  it('is exactly the "a quotation went out" states', () => {
    expect([...QUOTE_STATUSES].sort()).toEqual(['LOST', 'QUOTED', 'WON']);
  });
});

describe('setVersionStatus — no-ops', () => {
  it('does nothing when the version does not exist', async () => {
    const tx = fakeTx(null);
    expect(await run(tx, 'QUOTED')).toBe(false);
    expect(tx.rfqVersion.update).not.toHaveBeenCalled();
    expect(tx.rfq.update).not.toHaveBeenCalled();
  });

  it('does nothing when the status is unchanged (re-quoting must not move quotedAt)', async () => {
    const tx = fakeTx(v({ status: 'QUOTED', quotedAt: EARLIER }));
    expect(await run(tx, 'QUOTED')).toBe(false);
    expect(tx.rfqVersion.update).not.toHaveBeenCalled();
    expect(tx.rfq.update).not.toHaveBeenCalled();
  });
});

describe('setVersionStatus — entering QUOTED', () => {
  it('stamps quotedAt and clears any earlier decision', async () => {
    const tx = fakeTx(v({ status: 'COSTED' }));
    expect(await run(tx, 'QUOTED')).toBe(true);
    expect(versionWrite(tx)).toEqual({ status: 'QUOTED', quotedAt: NOW, decidedAt: null });
  });

  it('re-stamps quotedAt when a decided version is re-quoted (the latest quote is what counts)', async () => {
    const tx = fakeTx(v({ status: 'WON', quotedAt: EARLIER }));
    await run(tx, 'QUOTED');
    expect(versionWrite(tx)).toEqual({ status: 'QUOTED', quotedAt: NOW, decidedAt: null });
  });
});

describe('setVersionStatus — entering WON / LOST', () => {
  it.each(['WON', 'LOST'])('%s stamps decidedAt and keeps the original quotedAt', async (status) => {
    const tx = fakeTx(v({ status: 'QUOTED', quotedAt: EARLIER }));
    await run(tx, status);
    expect(versionWrite(tx)).toEqual({ status, decidedAt: NOW, quotedAt: EARLIER });
  });

  it.each(['WON', 'LOST'])('%s without ever being quoted backfills quotedAt with now', async (status) => {
    const tx = fakeTx(v({ status: 'COSTED', quotedAt: null }));
    await run(tx, status);
    expect(versionWrite(tx)).toEqual({ status, decidedAt: NOW, quotedAt: NOW });
  });
});

describe('setVersionStatus — leaving a quoted state', () => {
  it.each(['DRAFT', 'COSTED'])('moving back to %s clears decidedAt but keeps quotedAt untouched', async (status) => {
    const tx = fakeTx(v({ status: 'WON', quotedAt: EARLIER }));
    await run(tx, status);
    const data = versionWrite(tx);
    expect(data).toEqual({ status, decidedAt: null });
    expect(data).not.toHaveProperty('quotedAt');
  });
});

describe('setVersionStatus — the RFQ header follows the current revision', () => {
  it.each(['QUOTED', 'WON', 'LOST'])('copies %s to the RFQ when this is the current version', async (status) => {
    const tx = fakeTx(v({ status: 'COSTED', isCurrent: true, rfqId: 42n }));
    await run(tx, status);
    expect(tx.rfq.update).toHaveBeenCalledWith({ where: { id: 42n }, data: { status } });
  });

  it('does NOT touch the RFQ when an older (non-current) revision changes', async () => {
    const tx = fakeTx(v({ status: 'COSTED', isCurrent: false }));
    await run(tx, 'WON');
    expect(tx.rfq.update).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'COSTED'])('does NOT overwrite the RFQ status when going back to %s', async (status) => {
    const tx = fakeTx(v({ status: 'QUOTED', isCurrent: true }));
    await run(tx, status);
    expect(tx.rfq.update).not.toHaveBeenCalled();
  });
});

describe('setVersionStatus — the timestamp default', () => {
  it('uses the real clock when no "now" is passed', async () => {
    const tx = fakeTx(v({ status: 'COSTED' }));
    const before = Date.now();
    await setVersionStatus(tx as never, 7n, 'QUOTED');
    const stamped = (versionWrite(tx).quotedAt as Date).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });
});
