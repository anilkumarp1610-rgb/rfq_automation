import { beforeAll, describe, expect, it } from 'vitest';
import {
  as, createCustomer, createPart, createRfq, createUser, http,
  type RoleCode, type TestUser,
} from '../test-support/helpers.js';

/**
 * Role matrix. For each endpoint, which roles may call it. "May" means the request gets past
 * authentication/authorisation (any status except 401/403 — the body here is deliberately
 * empty/invalid, so allowed roles typically see 404/422/etc.). Denied roles must get exactly 403.
 */
type Method = 'get' | 'post' | 'put' | 'delete';
const ALL: RoleCode[] = ['ADMIN', 'MANAGER', 'ESTIMATOR', 'VIEWER'];
const EDIT_RFQ: RoleCode[] = ['ADMIN', 'MANAGER', 'ESTIMATOR'];
const EDIT_MASTERS: RoleCode[] = ['ADMIN', 'MANAGER'];
const ADMIN_ONLY: RoleCode[] = ['ADMIN'];

let users: Record<RoleCode, TestUser>;
let versionId: string;

beforeAll(async () => {
  users = {
    ADMIN: await createUser('ADMIN'),
    MANAGER: await createUser('MANAGER'),
    ESTIMATOR: await createUser('ESTIMATOR'),
    VIEWER: await createUser('VIEWER'),
  };
  const customer = await createCustomer(users.ADMIN);
  const part = await createPart(users.ADMIN, customer.id);
  versionId = (await createRfq(users.ADMIN, part.id)).versionId;
});

interface Case {
  name: string;
  method: Method;
  path: () => string;
  body?: Record<string, unknown>;
  allowed: RoleCode[];
}

const cases: Case[] = [
  // --- read access: everyone signed in --------------------------------
  { name: 'list RFQs', method: 'get', path: () => '/rfqs', allowed: ALL },
  { name: 'dashboard', method: 'get', path: () => '/reports/dashboard', allowed: ALL },
  { name: 'read the role catalogue', method: 'get', path: () => '/roles', allowed: ALL },
  { name: 'download the quotation PDF', method: 'get', path: () => `/rfq-versions/${versionId}/quotation.pdf`, allowed: ALL },

  // --- RFQ work: admin / manager / estimator ---------------------------
  { name: 'create an RFQ', method: 'post', path: () => '/rfqs', body: {}, allowed: EDIT_RFQ },
  { name: 'create a customer part', method: 'post', path: () => '/customer-parts', body: {}, allowed: EDIT_RFQ },
  { name: 'update a version', method: 'put', path: () => `/rfq-versions/${versionId}`, body: {}, allowed: EDIT_RFQ },
  { name: 'run compute', method: 'post', path: () => `/rfq-versions/${versionId}/compute`, body: { persist: false }, allowed: EDIT_RFQ },
  { name: 'replace process lines', method: 'put', path: () => `/rfq-versions/${versionId}/processes`, body: { lines: [] }, allowed: EDIT_RFQ },
  { name: 'analyze a spec', method: 'post', path: () => `/rfq-versions/${versionId}/analyze-spec`, body: {}, allowed: EDIT_RFQ },
  { name: 'spec-preview (wizard)', method: 'post', path: () => '/rfqs/spec-preview', body: {}, allowed: EDIT_RFQ },
  // the internal cost sheet is NOT for view-only users
  { name: 'download the cost-sheet PDF', method: 'get', path: () => `/rfq-versions/${versionId}/cost-sheet.pdf`, allowed: EDIT_RFQ },
  { name: 'download the cost-sheet XLSX', method: 'get', path: () => `/rfq-versions/${versionId}/cost-sheet.xlsx`, allowed: EDIT_RFQ },

  // --- masters + company + audit: admin / manager -----------------------
  { name: 'create a customer', method: 'post', path: () => '/customers', body: {}, allowed: EDIT_MASTERS },
  { name: 'create a material type', method: 'post', path: () => '/material/types', body: {}, allowed: EDIT_MASTERS },
  { name: 'create a process', method: 'post', path: () => '/processes', body: {}, allowed: EDIT_MASTERS },
  { name: 'update company details', method: 'put', path: () => '/company', body: {}, allowed: EDIT_MASTERS },
  { name: 'read the audit log', method: 'get', path: () => '/audit-log', allowed: EDIT_MASTERS },

  // --- security: admin only -------------------------------------------
  { name: 'list users', method: 'get', path: () => '/users', allowed: ADMIN_ONLY },
  { name: 'create a user', method: 'post', path: () => '/users', body: {}, allowed: ADMIN_ONLY },
  { name: 'update a user', method: 'put', path: () => '/users/1', body: {}, allowed: ADMIN_ONLY },
  { name: 'delete a user', method: 'delete', path: () => '/users/999999999', allowed: ADMIN_ONLY },
  { name: 'create a role', method: 'post', path: () => '/roles', body: {}, allowed: ADMIN_ONLY },
  { name: 'update a role', method: 'put', path: () => '/roles/1', body: {}, allowed: ADMIN_ONLY },
];

describe.each(cases)('$method $name', (c) => {
  it.each(ALL)('%s', async (role) => {
    const res = await as(users[role])[c.method](c.path()).send(c.body ?? {});
    if (c.allowed.includes(role)) {
      expect([401, 403], `${role} should be allowed to ${c.name}, got ${res.status}`).not.toContain(res.status);
    } else {
      expect(res.status, `${role} must be forbidden from ${c.name}`).toBe(403);
    }
  });

  it('anonymous', async () => {
    const res = await http()[c.method](c.path()).send(c.body ?? {});
    expect(res.status).toBe(401);
  });
});

describe('roles are never deletable', () => {
  it('DELETE /roles/:id is 405 for an admin and 403 for everyone else', async () => {
    expect((await as(users.ADMIN).delete('/roles/1')).status).toBe(405);
    for (const r of ['MANAGER', 'ESTIMATOR', 'VIEWER'] as const) {
      expect((await as(users[r]).delete('/roles/1')).status).toBe(403);
    }
  });
});

describe('a VIEWER can read but not write RFQ data', () => {
  it('can open an RFQ version but cannot change it', async () => {
    expect((await as(users.VIEWER).get(`/rfq-versions/${versionId}`)).status).toBe(200);
    expect((await as(users.VIEWER).put(`/rfq-versions/${versionId}`).send({ status: 'QUOTED' })).status).toBe(403);
  });
});
