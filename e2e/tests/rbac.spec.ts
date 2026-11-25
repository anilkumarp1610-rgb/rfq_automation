import { expect, test, type Page } from '@playwright/test';
import { signIn, type Role } from './support';

const nav = (page: Page, name: string) => page.getByRole('link', { name, exact: true });

/** What each role sees in the sidebar, and which pages bounce them back to the dashboard. */
const matrix: { role: Role; sees: string[]; hidden: string[]; blocked: string[] }[] = [
  {
    role: 'viewer',
    sees: ['Dashboard', 'RFQs'],
    hidden: ['Customer Parts', 'Audit Log', 'Security'],
    blocked: ['/customer-parts', '/masters/customers', '/rfqs/new', '/security'],
  },
  {
    role: 'estimator',
    sees: ['Dashboard', 'RFQs', 'Customer Parts'],
    hidden: ['Audit Log', 'Security'],
    blocked: ['/masters/customers', '/security'],
  },
  {
    role: 'manager',
    sees: ['Dashboard', 'RFQs', 'Customer Parts', 'Audit Log'],
    hidden: ['Security'],
    blocked: ['/security'],
  },
  {
    role: 'admin',
    sees: ['Dashboard', 'RFQs', 'Customer Parts', 'Audit Log', 'Security'],
    hidden: [],
    blocked: [],
  },
];

for (const { role, sees, hidden, blocked } of matrix) {
  test.describe(`as ${role}`, () => {
    test.beforeEach(async ({ page, request }) => signIn(page, request, role));

    test('the sidebar shows only what this role may use', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
      for (const item of sees) await expect(nav(page, item)).toBeVisible();
      for (const item of hidden) await expect(nav(page, item)).toHaveCount(0);
    });

    for (const path of blocked) {
      test(`typing ${path} into the address bar goes back to the dashboard`, async ({ page }) => {
        await page.goto(path);
        await expect(page).toHaveURL(/\/$/);
        await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
      });
    }
  });
}

test('only managers and admins get the Masters section', async ({ page, request }) => {
  for (const role of ['viewer', 'estimator'] as const) {
    await signIn(page, request, role);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Masters' })).toHaveCount(0);
  }
});

test.describe('RFQ list actions follow the role', () => {
  test('a viewer can read RFQs but has no way to create one', async ({ page, request }) => {
    await signIn(page, request, 'viewer');
    await page.goto('/rfqs');
    await expect(page.getByRole('heading', { name: 'RFQs' })).toBeVisible();
    await expect(page.getByRole('link', { name: /New RFQ from spec/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Manual' })).toHaveCount(0);
  });

  test('an estimator can', async ({ page, request }) => {
    await signIn(page, request, 'estimator');
    await page.goto('/rfqs');
    await expect(page.getByRole('link', { name: /New RFQ from spec/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Manual' })).toBeVisible();
  });

  test('a viewer opening an RFQ sees it read-only', async ({ page, request }) => {
    await signIn(page, request, 'viewer');
    await page.goto('/rfqs');
    await page.getByPlaceholder('Search RFQ / part…').fill('E2E-PG-001');
    await page.getByRole('link', { name: 'E2E-PG-001' }).click();
    await expect(page.getByRole('heading', { name: 'E2E-PG-001' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compute cost' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Generate quotation/ })).toHaveCount(0);
  });
});
