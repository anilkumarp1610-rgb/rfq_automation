import { prisma } from './prisma.js';

/**
 * The single company / firm profile (or null if not set up yet). `singleton` is a
 * unique column so there can only ever be one such row; the `orderBy` is just a
 * deterministic tie-breaker for safety.
 */
export function getCompanySettings() {
  return prisma.companySettings.findFirst({
    where: { singleton: true },
    orderBy: { id: 'asc' },
  });
}
