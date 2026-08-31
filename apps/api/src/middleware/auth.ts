import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../lib/jwt.js';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
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
