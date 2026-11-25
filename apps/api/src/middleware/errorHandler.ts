import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

export interface AppError extends Error {
  status?: number;
  code?: string;
  /**
   * Set on a 5xx whose message was written for the user and is safe to show ("the model declined
   * this file"). Any other 5xx is an unexpected failure whose message may name tables, hosts or
   * keys, so the client gets a generic one instead.
   */
  expose?: boolean;
}

/**
 * A fixed, user-safe explanation for a failed AI call. The provider's own message is never
 * forwarded (it can echo request details); these cover the cases an operator can act on.
 */
function providerMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const text = String(err.message).toLowerCase();
  if (/credit balance/.test(text)) {
    return 'The Anthropic account has no credit left — add credit under Plans & Billing, then retry';
  }
  if (err.status === 401 || err.status === 403) {
    return 'The AI service rejected the API key — check ANTHROPIC_API_KEY in apps/api/.env and restart the API';
  }
  if (err.status === 429) return 'The AI service is rate-limiting requests — wait a minute and retry';
  if (err.status === 413 || /too long|too large|too many pages|page limit/.test(text)) {
    return 'The AI service could not take this file (too large or too many pages) — try a smaller or single-sheet drawing';
  }
  if (typeof err.status === 'number' && err.status >= 500) {
    return 'The AI service is temporarily unavailable — retry shortly';
  }
  return 'The AI service request failed — try again, or contact an administrator';
}

export function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: 'Validation failed',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    // e.g. ?sort=<unknown column>. The raw message names internals, so keep it generic.
    return res.status(400).json({ error: 'Invalid request parameters' });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const raw = err.meta?.target;
      const cols = Array.isArray(raw) ? raw.join(', ') : undefined;
      return res.status(409).json({
        error: cols
          ? `A record with this ${cols} already exists`
          : 'A record with these values already exists',
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Record not found' });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({ error: 'Related record in use; cannot complete the operation' });
    }
  }

  // A failed call to the AI provider (bad/expired key, rate limit, outage). Its status is the
  // provider's, not ours — passing a 401 through would make the browser think the *user's* session
  // expired — and its message echoes the provider's response, so report a plain 502.
  if (err instanceof Anthropic.APIError) {
    console.error('AI provider error:', err);
    return res.status(502).json({ error: providerMessage(err) });
  }

  const status = err.status ?? 500;
  const isDev = process.env.NODE_ENV === 'development';
  if (status >= 500) console.error('Error:', err);

  // Unexpected server errors (no status, or a 5xx not marked `expose`) carry internal detail.
  // Show the real message only to developers; everyone else sees a generic one (it is logged above).
  const hide = status >= 500 && !err.expose && !isDev;

  res.status(status).json({
    error: hide ? 'Internal server error' : err.message || 'Internal server error',
    ...(isDev && status >= 500 ? { stack: err.stack } : {}),
  });
}
