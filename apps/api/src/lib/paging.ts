import type { Response } from 'express';
import { badRequest } from './http.js';

/** Hard ceiling so one request can never pull an unbounded result set. */
export const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 25;

export interface Paging {
  /** 1-based */
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  /** the client's requested sort key, still unvalidated — callers map it to a real column */
  sort?: string;
  dir: 'asc' | 'desc';
}

/**
 * Optional, backward-compatible paging for list endpoints.
 *
 *  - No `page` / `pageSize` in the query  -> `null`: the caller returns the whole list exactly as before.
 *  - Otherwise `?page=1&pageSize=25[&sort=<key>&dir=asc|desc]` -> one page; the caller sends the rows
 *    as a plain array and the full (filtered) count in the `X-Total-Count` header via `sendPage`.
 */
export function parsePaging(query: Record<string, unknown>): Paging | null {
  if (query.page === undefined && query.pageSize === undefined) return null;

  const page = query.page === undefined ? 1 : Number(query.page);
  const requested = query.pageSize === undefined ? DEFAULT_PAGE_SIZE : Number(query.pageSize);
  if (!Number.isInteger(page) || page < 1) badRequest('page must be a whole number ≥ 1', 422);
  if (!Number.isInteger(requested) || requested < 1) badRequest('pageSize must be a whole number ≥ 1', 422);

  const pageSize = Math.min(requested, MAX_PAGE_SIZE);
  let sort: string | undefined;
  if (query.sort !== undefined && query.sort !== '') {
    if (typeof query.sort !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(query.sort)) {
      badRequest('Invalid sort key', 422);
    }
    sort = query.sort as string;
  }
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
    sort,
    dir: query.dir === 'desc' ? 'desc' : 'asc',
  };
}

/** Send one page: rows as the body, the filtered total in `X-Total-Count`. */
export function sendPage<T>(res: Response, rows: T[], total: number) {
  res.setHeader('X-Total-Count', String(total));
  res.json(rows);
}
