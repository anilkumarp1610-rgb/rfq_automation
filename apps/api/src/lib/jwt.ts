import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './env.js';

export interface JwtPayload {
  userId: string;
  email: string;
  roles: string[];
}

export function generateToken(payload: JwtPayload, expiresIn: string | number = '24h'): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn as any });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}
