import { describe, expect, it, vi } from 'vitest';
import { MAX_PAGE_SIZE, parsePaging, sendPage } from './paging.js';

/** Run `fn`, expect it to throw, and return the error (so we can check its HTTP status). */
function thrown(fn: () => unknown): Error & { status?: number } {
  try {
    fn();
  } catch (e) {
    return e as Error & { status?: number };
  }
  throw new Error('expected a throw');
}

describe('parsePaging — opting in', () => {
  it('returns null (= "send the whole list, as before") when neither page nor pageSize is given', () => {
    expect(parsePaging({})).toBeNull();
    expect(parsePaging({ search: 'x', status: 'DRAFT' })).toBeNull();
    expect(parsePaging({ sort: 'name', dir: 'desc' })).toBeNull(); // sort alone does not switch paging on
  });

  it('either parameter alone switches it on, with defaults for the other', () => {
    expect(parsePaging({ page: '2' })).toMatchObject({ page: 2, pageSize: 25 });
    expect(parsePaging({ pageSize: '10' })).toMatchObject({ page: 1, pageSize: 10 });
  });
});

describe('parsePaging — the arithmetic', () => {
  it.each([
    [1, 25, 0],
    [2, 25, 25],
    [3, 10, 20],
    [10, 200, 1800],
  ])('page %i of size %i skips %i rows', (page, pageSize, skip) => {
    const p = parsePaging({ page: String(page), pageSize: String(pageSize) })!;
    expect(p).toMatchObject({ page, pageSize, skip, take: pageSize });
  });

  it('accepts real numbers as well as query-string text', () => {
    expect(parsePaging({ page: 3, pageSize: 5 })).toMatchObject({ page: 3, pageSize: 5, skip: 10, take: 5 });
  });
});

describe('parsePaging — limits', () => {
  it(`caps the page size at ${MAX_PAGE_SIZE} rather than allowing an unbounded response`, () => {
    expect(parsePaging({ page: '1', pageSize: '100000' })).toMatchObject({ pageSize: MAX_PAGE_SIZE, take: MAX_PAGE_SIZE });
    expect(parsePaging({ page: '1', pageSize: String(MAX_PAGE_SIZE) })!.pageSize).toBe(MAX_PAGE_SIZE);
    expect(parsePaging({ page: '1', pageSize: String(MAX_PAGE_SIZE + 1) })!.pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('the skip uses the CAPPED size, so pages stay consistent', () => {
    expect(parsePaging({ page: '2', pageSize: '5000' })).toMatchObject({ skip: MAX_PAGE_SIZE });
  });

  it.each([
    ['page', '0'],
    ['page', '-3'],
    ['page', 'abc'],
    ['page', '1.5'],
    ['page', ''],
    ['pageSize', '0'],
    ['pageSize', '-1'],
    ['pageSize', 'many'],
    ['pageSize', '2.5'],
    ['pageSize', ''],
  ])('rejects %s=%j with a 422', (key, value) => {
    const q: Record<string, unknown> = { page: '1', pageSize: '10', [key]: value };
    const err = thrown(() => parsePaging(q));
    expect(err.status).toBe(422);
    expect(err.message).toMatch(new RegExp(key));
  });
});

describe('parsePaging — sorting', () => {
  it('passes a safe sort key through, defaulting to ascending', () => {
    expect(parsePaging({ page: '1', sort: 'rfqNumber' })).toMatchObject({ sort: 'rfqNumber', dir: 'asc' });
  });

  it('only "desc" means descending; anything else is ascending', () => {
    expect(parsePaging({ page: '1', dir: 'desc' })!.dir).toBe('desc');
    expect(parsePaging({ page: '1', dir: 'DESC' })!.dir).toBe('asc');
    expect(parsePaging({ page: '1', dir: 'sideways' })!.dir).toBe('asc');
  });

  it('treats an empty sort as "no sort"', () => {
    expect(parsePaging({ page: '1', sort: '' })!.sort).toBeUndefined();
    expect(parsePaging({ page: '1' })!.sort).toBeUndefined();
  });

  it.each([
    ['a space', 'name desc'],
    ['SQL-ish text', 'id; DROP TABLE users'],
    ['a dot path', 'customer.name'],
    ['a leading digit', '1name'],
    ['an underscore start', '_id'],
    ['a quote', "x'y"],
    ['an over-long key', 'a'.repeat(61)],
  ])('rejects %s as an invalid sort key (422)', (_label, sort) => {
    expect(thrown(() => parsePaging({ page: '1', sort })).status).toBe(422);
  });

  it('rejects a non-string sort (e.g. ?sort=a&sort=b becomes an array)', () => {
    expect(thrown(() => parsePaging({ page: '1', sort: ['a', 'b'] })).status).toBe(422);
  });

  it('accepts the longest allowed key (60 chars)', () => {
    expect(parsePaging({ page: '1', sort: 'a'.repeat(60) })!.sort).toHaveLength(60);
  });
});

describe('sendPage', () => {
  it('sends the rows as the body and the total in X-Total-Count', () => {
    const res = { setHeader: vi.fn(), json: vi.fn() };
    sendPage(res as never, [{ id: 1 }, { id: 2 }], 57);
    expect(res.setHeader).toHaveBeenCalledWith('X-Total-Count', '57');
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }]);
  });

  it('reports a total of 0 for an empty page', () => {
    const res = { setHeader: vi.fn(), json: vi.fn() };
    sendPage(res as never, [], 0);
    expect(res.setHeader).toHaveBeenCalledWith('X-Total-Count', '0');
    expect(res.json).toHaveBeenCalledWith([]);
  });
});
