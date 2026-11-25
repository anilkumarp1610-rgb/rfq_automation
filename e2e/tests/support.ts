import type { APIRequestContext, Page } from '@playwright/test';

export const API = 'http://localhost:4010';
export const PASSWORD = 'E2e@12345';
export const PAGING_PREFIX = 'E2E-PG-';
export const PAGING_COUNT = 30;
export const FIXTURE_PART = 'E2E-PART-1';

export type Role = 'admin' | 'manager' | 'estimator' | 'viewer';
export const emailOf = (who: Role | 'leaver') => `e2e-${who}@e2e.local`;

/** Log in through the API and return the session the app keeps in localStorage. */
export async function apiLogin(request: APIRequestContext, who: Role | 'leaver') {
  const res = await request.post(`${API}/auth/login`, { data: { email: emailOf(who), password: PASSWORD } });
  if (!res.ok()) throw new Error(`login as ${who} failed: ${res.status()}`);
  return (await res.json()) as { token: string; user: { id: string; email: string; name: string; roles: string[] } };
}

/** Start the page already signed in (skips the login form; the login spec covers that). */
export async function signIn(page: Page, request: APIRequestContext, who: Role | 'leaver') {
  const { token, user } = await apiLogin(request, who);
  await page.addInitScript(
    ([t, u]) => {
      // once per tab: later page loads must see what the app itself did (e.g. dropped a rejected session)
      if (sessionStorage.getItem('__e2e_seeded')) return;
      sessionStorage.setItem('__e2e_seeded', '1');
      localStorage.setItem('token', t);
      localStorage.setItem('user', u);
    },
    [token, JSON.stringify(user)]
  );
}

/** Admin-only helper: switch a user on or off through the real API. */
export async function setActive(request: APIRequestContext, email: string, isActive: boolean) {
  const { token } = await apiLogin(request, 'admin');
  const headers = { Authorization: `Bearer ${token}` };
  const users = (await (await request.get(`${API}/users`, { headers })).json()) as any[];
  const u = users.find((x) => x.email === email);
  if (!u) throw new Error(`no such user ${email}`);
  const res = await request.put(`${API}/users/${u.id}`, {
    headers,
    data: { name: u.name, email: u.email, phone: u.phone ?? '', roleId: String(u.role.id), isActive },
  });
  if (!res.ok()) throw new Error(`setActive failed: ${res.status()} ${await res.text()}`);
}
