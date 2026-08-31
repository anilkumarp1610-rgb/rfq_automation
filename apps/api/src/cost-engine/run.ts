import { prisma } from '../lib/prisma.js';
import { resolveEngineInput, ResolveOptions } from './resolve.js';
import { computeCost } from './engine.js';
import { CostSummary } from './types.js';

function summaryToRow(s: CostSummary) {
  return {
    materialCost: s.materialCost,
    handlingCost: s.handlingCost,
    machiningCost: s.machiningCost,
    manualCost: s.manualCost,
    subcontractCost: s.subcontractCost,
    qcCost: s.qcCost,
    mfgCost: s.mfgCost,
    adminCost: s.adminCost,
    subtotal: s.subtotal,
    marginPct: s.marginPct,
    marginAmount: s.marginAmount,
    quotedPricePerPc: s.quotedPricePerPc,
    totalQuote: s.totalQuote,
    aiRecommendedMarginPct: s.aiRecommendedMarginPct,
    explainJson: JSON.stringify(s.explain),
    computedAt: new Date(),
  };
}

export interface RunComputeResult {
  summary: CostSummary;
  warnings: string[];
  /** the version's status before this run */
  priorStatus: string;
}

/**
 * Resolve a version's masters, run the deterministic engine and (optionally)
 * persist the cost summary + per-line costs + move DRAFT → COSTED.
 * Shared by `POST /rfq-versions/:id/compute` and the spec wizard.
 */
export async function runCompute(
  versionId: bigint,
  opts: ResolveOptions & { persist?: boolean } = {}
): Promise<RunComputeResult | null> {
  const resolved = await resolveEngineInput(versionId, opts);
  if (!resolved) return null;

  const summary = computeCost(resolved.input);

  if (opts.persist) {
    await prisma.$transaction(async (tx) => {
      const row = summaryToRow(summary);
      await tx.rfqCostSummary.upsert({
        where: { rfqVersionId: versionId },
        create: { rfqVersionId: versionId, ...row },
        update: row,
      });
      for (const p of summary.processes) {
        if (!p.ref) continue;
        await tx.rfqProcess.update({
          where: { id: BigInt(p.ref) },
          data: { cost: p.cost, rate: p.rate, method: p.method },
        });
      }
      if (resolved.version.status === 'DRAFT') {
        await tx.rfqVersion.update({ where: { id: versionId }, data: { status: 'COSTED' } });
      }
    });
  }

  return { summary, warnings: resolved.warnings, priorStatus: resolved.version.status };
}
