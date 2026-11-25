import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { request } from '@playwright/test';
import { API, PASSWORD, PAGING_PREFIX, PAGING_COUNT, FIXTURE_PART } from './tests/support';

/** Runs once, after the API and web servers are up. */
export default async function globalSetup() {
  // 1. fixture users (direct DB write, RFQ_TEST only — see seed.ts)
  execFileSync('npx tsx e2e/server/seed.ts', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', shell: true });

  // 2. fixture data through the real API, so the browser tests start from a known state
  const api = await request.newContext({ baseURL: API });
  const login = await api.post('/auth/login', { data: { email: 'e2e-admin@e2e.local', password: PASSWORD } });
  if (!login.ok()) throw new Error(`global-setup: admin login failed (${login.status()})`);
  const headers = { Authorization: `Bearer ${(await login.json()).token}` };

  const find = async (url: string, pick: (r: any) => boolean) =>
    ((await (await api.get(url, { headers })).json()) as any[]).find(pick);

  let customer = await find('/customers?search=E2E', (c) => c.code === 'E2ECUST');
  if (!customer) {
    const res = await api.post('/customers', { headers, data: { code: 'E2ECUST', name: 'E2E Customer', rating: 3 } });
    if (!res.ok()) throw new Error(`global-setup: customer create failed ${res.status()} ${await res.text()}`);
    customer = await res.json();
  }

  let part = await find('/customer-parts', (p) => p.customerPartNumber === FIXTURE_PART);
  if (!part) {
    const res = await api.post('/customer-parts', {
      headers,
      data: { customerId: customer.id, customerPartNumber: FIXTURE_PART, partName: 'E2E fixture part', currentRevision: 'R00' },
    });
    if (!res.ok()) throw new Error(`global-setup: part create failed ${res.status()} ${await res.text()}`);
    part = await res.json();
  }

  // enough RFQs to need three pages at the smallest page size and two at the default
  const existing = new Set(
    ((await (await api.get(`/rfqs?search=${PAGING_PREFIX}`, { headers })).json()) as any[]).map((r) => r.rfqNumber)
  );
  for (let i = 1; i <= PAGING_COUNT; i++) {
    const rfqNumber = `${PAGING_PREFIX}${String(i).padStart(3, '0')}`;
    if (existing.has(rfqNumber)) continue;
    const res = await api.post('/rfqs', { headers, data: { rfqNumber, customerPartId: part.id, annualQty: 1000, batchQty: 100 } });
    if (!res.ok()) throw new Error(`global-setup: RFQ ${rfqNumber} failed ${res.status()} ${await res.text()}`);
  }
  await api.dispose();
}
