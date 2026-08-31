import { prisma } from './prisma.js';
import { AuthRequest } from '../middleware/auth.js';

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'COMPUTE'
  | 'QUOTE'
  | 'ANALYZE'
  | 'REVIEW';

export interface AuditEntry {
  entityType: string;
  entityId: string | number | bigint;
  action: AuditAction;
  changes?: unknown;
}

/**
 * Append an audit row. Fire-and-forget: a logging failure must never break the
 * request it is recording, so this swallows its own errors.
 */
export async function audit(req: AuthRequest, entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: entry.entityType,
        entityId: BigInt(entry.entityId),
        action: entry.action,
        changes: JSON.stringify(entry.changes ?? {}, (_k, v) =>
          typeof v === 'bigint' ? v.toString() : v
        ),
        createdBy: req.user ? BigInt(req.user.userId) : null,
      },
    });
  } catch (e) {
    console.error('audit log write failed:', e);
  }
}
