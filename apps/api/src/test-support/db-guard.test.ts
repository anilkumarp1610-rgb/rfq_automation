import { describe, expect, it } from 'vitest';
import {
  assertConnectedToTestDb,
  assertTestDatabaseUrl,
  databaseName,
  deriveTestUrl,
} from './db-guard.js';

const LIVE = 'sqlserver://localhost:11433;database=RFQ_DB;user=SA;password=p@ss;encrypt=true;trustServerCertificate=true';

describe('databaseName', () => {
  it('reads the database from a Prisma SQL Server URL', () => {
    expect(databaseName(LIVE)).toBe('RFQ_DB');
    expect(databaseName('sqlserver://h:1433;initial catalog=Foo;user=a')).toBe('Foo');
  });
  it('returns null when there is none', () => {
    expect(databaseName('sqlserver://h:1433;user=a')).toBeNull();
    expect(databaseName(undefined)).toBeNull();
  });
});

describe('deriveTestUrl', () => {
  it('swaps only the database name and keeps host, credentials and options', () => {
    const url = deriveTestUrl({ DATABASE_URL: LIVE });
    expect(databaseName(url)).toBe('RFQ_TEST');
    expect(url).toContain('localhost:11433');
    expect(url).toContain('user=SA;password=p@ss');
    expect(url).toContain('trustServerCertificate=true');
  });
  it('prefers an explicit TEST_DATABASE_URL (CI)', () => {
    const ci = 'sqlserver://sql:1433;database=RFQ_TEST;user=SA;password=x';
    expect(deriveTestUrl({ DATABASE_URL: LIVE, TEST_DATABASE_URL: ci })).toBe(ci);
  });
  it('fails clearly with no database configured', () => {
    expect(() => deriveTestUrl({})).toThrow(/TEST_DATABASE_URL/);
    expect(() => deriveTestUrl({ DATABASE_URL: 'sqlserver://h:1433;user=a' })).toThrow(/database=/);
  });
});

describe('assertTestDatabaseUrl', () => {
  it('accepts *_TEST databases', () => {
    expect(() => assertTestDatabaseUrl('sqlserver://h;database=RFQ_TEST;user=a')).not.toThrow();
    expect(() => assertTestDatabaseUrl('sqlserver://h;database=anything_test;user=a')).not.toThrow();
  });
  it('REFUSES the live database and anything else', () => {
    expect(() => assertTestDatabaseUrl(LIVE)).toThrow(/Refusing/);
    expect(() => assertTestDatabaseUrl('sqlserver://h;database=IAC_V2_Live;user=a')).toThrow(/Refusing/);
    expect(() => assertTestDatabaseUrl('sqlserver://h;database=TEST_RFQ;user=a')).toThrow(/Refusing/); // must END in _TEST
    expect(() => assertTestDatabaseUrl('sqlserver://h;user=a')).toThrow(/Refusing/);
  });
});

describe('assertConnectedToTestDb', () => {
  it('passes only for *_TEST', () => {
    expect(() => assertConnectedToTestDb('RFQ_TEST')).not.toThrow();
    expect(() => assertConnectedToTestDb('RFQ_DB')).toThrow(/aborting/);
    expect(() => assertConnectedToTestDb(null)).toThrow();
  });
});
