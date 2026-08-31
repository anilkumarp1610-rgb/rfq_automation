/**
 * End-to-end smoke test — exercises the full RFQ lifecycle against a running API.
 *   npm run smoke                 (defaults to http://localhost:4000)
 *   SMOKE_URL=https://host npm run smoke
 * Exits non-zero on the first failed check.
 */
const BASE = process.env.SMOKE_URL || process.argv[2] || 'http://localhost:4000';
const EMAIL = process.env.SMOKE_EMAIL || 'admin@rfq.local';
const PASS = process.env.SMOKE_PASS || 'Admin@123';

let token = '';
let ok = 0;
let failed = 0;
const stamp = Date.now();

async function api(method, path, body, raw = false) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function check(name, cond, detail) {
  if (cond) {
    ok++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

async function main() {
  console.log(`Smoke test → ${BASE}\n`);

  check('health', (await api('GET', '/health')).status === 200);

  const login = await api('POST', '/auth/login', { email: EMAIL, password: PASS });
  check('login', login.status === 200 && !!login.data?.token, login.data);
  token = login.data?.token;
  if (!token) return finish();

  check('auth/me', (await api('GET', '/auth/me')).data?.roles?.includes('ADMIN'));

  const dash = await api('GET', '/reports/dashboard');
  check('dashboard', dash.status === 200 && typeof dash.data?.counts?.rfqs === 'number');

  // masters needed for a costable RFQ
  const mt = await api('POST', '/material/types', { name: `SmokeSteel ${stamp}` });
  check('create material type', mt.status === 201, mt.data);
  const cat = await api('POST', '/material/categories', {
    materialTypeId: String(mt.data.id),
    gradeCode: `SMK${stamp}`,
    densityKgM3: 7850,
  });
  check('create grade', cat.status === 201, cat.data);
  const shape = await api('POST', '/material/shapes', { name: `SmokeBar ${stamp}` });
  const size = await api('POST', '/material/size-configs', {
    materialCategoryId: String(cat.data.id),
    materialShapeId: String(shape.data.id),
    odMm: 30,
    lengthMm: 3000,
    uom: 'kg',
  });
  check('create size config', size.status === 201, size.data);
  const price = await api('POST', '/material/prices', {
    materialSizeConfigId: String(size.data.id),
    ratePerKg: 90,
    effectiveFrom: new Date().toISOString(),
  });
  check('create material price', price.status === 201, price.data);

  check(
    'effective-date validation rejects bad range',
    (
      await api('POST', '/material/prices', {
        materialSizeConfigId: String(size.data.id),
        ratePerKg: 1,
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-01-01',
      })
    ).status === 422
  );

  const proc = await api('POST', '/processes', {
    name: `SmokeTurn ${stamp}`,
    processType: 'MACHINE',
    costingMethod: 'FLAT_PC',
    defaultRate: 20,
    uom: 'pc',
  });

  const customer = await api('POST', '/customers', {
    code: `SMK${stamp}`,
    name: 'Smoke Test Co',
    rating: 3,
  });
  const pt = await api('POST', '/product-types', { name: `SmokeShaft ${stamp}` });
  const part = await api('POST', '/customer-parts', {
    customerId: String(customer.data.id),
    customerPartNumber: `SMK-${stamp}`,
    partName: 'Smoke shaft',
    productTypeId: String(pt.data.id),
    currentRevision: 'R00',
  });
  check('create customer part', part.status === 201, part.data);

  const rfq = await api('POST', '/rfqs', {
    rfqNumber: `SMK-RFQ-${stamp}`,
    customerPartId: String(part.data.id),
    annualQty: 1000,
    batchQty: 100,
  });
  check('create RFQ + version 1', rfq.status === 201 && rfq.data.versions?.length === 1, rfq.data);
  const versionId = String(rfq.data.versions[0].id);

  const attrs = await api('PUT', `/rfq-versions/${versionId}`, {
    partAttributes: {
      materialCategoryId: String(cat.data.id),
      materialShapeId: String(shape.data.id),
      netWeightKg: 0.5,
      forgingLossPct: 10,
      productTypeId: String(pt.data.id),
    },
  });
  check('set part attributes', attrs.status === 200);

  const procs = await api('PUT', `/rfq-versions/${versionId}/processes`, {
    lines: [{ processId: String(proc.data.id), method: 'FLAT_PC', quantityOrTime: 1, rate: 20, sequence: 1 }],
  });
  check('set process lines', procs.status === 200);

  const compute = await api('POST', `/rfq-versions/${versionId}/compute`, { quantity: 1000 });
  check(
    'compute cost',
    compute.status === 200 && compute.data?.summary?.quotedPricePerPc > 0,
    compute.data?.warnings
  );

  const similar = await api('GET', `/reference/similar?versionId=${versionId}`);
  check('similar lookup', similar.status === 200 && Array.isArray(similar.data?.matches));

  const analyze = await api('POST', `/rfq-versions/${versionId}/analyze-spec`, {});
  // no drawing anywhere for this part → 409 asking for an upload
  check(
    'analyze without a drawing asks for an upload',
    analyze.status === 409 && analyze.data?.needsUpload === true,
    analyze.data
  );

  const quote = await api('POST', `/rfq-versions/${versionId}/quote`, {});
  check('generate quotation', quote.status === 200 && !!quote.data?.quotation?.quoteNo, quote.data);

  const pdf = await api('GET', `/rfq-versions/${versionId}/cost-sheet.pdf`, null, true);
  const head = Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString();
  check('cost-sheet.pdf download', pdf.status === 200 && head === '%PDF', head);

  const xlsx = await api('GET', `/rfq-versions/${versionId}/cost-sheet.xlsx`, null, true);
  const xhead = Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString();
  check('cost-sheet.xlsx download', xlsx.status === 200 && xhead === 'PK', xhead);

  const audit = await api('GET', '/audit-log?limit=20');
  check(
    'audit log recorded the activity',
    audit.status === 200 && audit.data.some((r) => r.action === 'QUOTE'),
    audit.status
  );

  // --- Users & roles -------------------------------------------------
  const roles = await api('GET', '/roles');
  check(
    'roles catalogue has the built-in roles',
    roles.status === 200 &&
      ['ADMIN', 'MANAGER', 'ESTIMATOR', 'VIEWER'].every((c) =>
        roles.data.some((r) => r.code === c && r.isSystem)
      ),
    roles.data
  );
  const viewerRole = roles.data?.find((r) => r.code === 'VIEWER');

  const newUser = await api('POST', '/users', {
    name: `Smoke Viewer ${stamp}`,
    email: `smoke.viewer.${stamp}@rfq.local`,
    phone: '99999',
    password: 'Viewer@123',
    roleId: String(viewerRole.id),
  });
  check('create a view-only user', newUser.status === 201 && newUser.data?.role?.code === 'VIEWER', newUser.data);

  const viewerLogin = await api('POST', '/auth/login', {
    email: `smoke.viewer.${stamp}@rfq.local`,
    password: 'Viewer@123',
  });
  const viewerToken = viewerLogin.data?.token;
  const savedToken = token;
  token = viewerToken;
  check(
    'view-only user is blocked from editing masters and RFQs',
    (await api('POST', '/customers', { code: `V${stamp}`, name: 'x', rating: 3 })).status === 403 &&
      (await api('POST', '/users', {})).status === 403
  );
  token = savedToken;

  const deactivated = await api('DELETE', `/users/${newUser.data.id}`);
  check('deactivate the user', deactivated.status === 204);

  const roleDelete = await api('DELETE', `/roles/${viewerRole.id}`);
  check('roles cannot be deleted', roleDelete.status === 405, roleDelete.data);

  finish();
}

function finish() {
  console.log(`\n${ok} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('smoke test crashed:', e);
  process.exit(1);
});
