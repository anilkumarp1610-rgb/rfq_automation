import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * Verify the bearer token, then load the user's CURRENT state from the database.
 *
 * The token only proves who the caller is. Whether they may still act — and in which roles — is
 * decided by the live `users` / `user_roles` rows on every request, so deactivating or demoting
 * someone takes effect immediately instead of when their token (up to 24 h) expires. The roles
 * on `req.user` therefore come from the database, never from the token.
 */
export async function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(decoded.userId) },
      select: { email: true, isActive: true, roles: { select: { role: { select: { code: true } } } } },
    });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'This account is inactive or no longer exists' });
    }
    req.user = {
      userId: decoded.userId,
      email: user.email,
      roles: user.roles.map((r) => r.role.code),
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Require the authenticated user to hold at least one of the given roles (ADMIN always passes). */
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const held = req.user.roles ?? [];
    if (held.includes('ADMIN') || held.some((r) => roles.includes(r))) {
      return next();
    }
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

/** Current user's id as a BigInt (routes run after authenticateToken). */
export function userId(req: AuthRequest): bigint {
  return BigInt(req.user!.userId);
}

/** Roles allowed to mutate master data. */
export const canEditMasters = requireRole('ADMIN', 'MANAGER');

/** Roles allowed to work on RFQs / estimates. */
export const canEditRfq = requireRole('ADMIN', 'MANAGER', 'ESTIMATOR');

/** Only administrators manage users and roles. */
export const canManageUsers = requireRole('ADMIN');
