import { expect, test } from '@playwright/test';
import { signIn } from './support';

test.describe('customer master (manager)', () => {
  test.beforeEach(async ({ page, request }) => signIn(page, request, 'manager'));

  test('create, find, reject a duplicate, edit and delete a customer', async ({ page }) => {
    const code = `E2E${Date.now()}`.slice(0, 20);
    await page.goto('/masters/customers');
    await expect(page.getByRole('heading', { name: 'Customer Master' })).toBeVisible();

    // create
    await page.getByRole('button', { name: 'New' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Code/).fill(code);
    await dialog.getByLabel(/^Name/).fill(`Browser Test ${code}`);
    await dialog.getByLabel(/^Rating/).fill('4');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Created')).toBeVisible();

    // find it through the server-side search
    await page.getByPlaceholder('Search…').fill(code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await expect(page.getByText('1–1 of 1')).toBeVisible();

    // a duplicate code is refused, not silently merged
    await page.getByRole('button', { name: 'New' }).click();
    await dialog.getByLabel(/^Code/).fill(code);
    await dialog.getByLabel(/^Name/).fill('Duplicate');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/already exists/i)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // edit
    await row.getByRole('button').first().click();
    await dialog.getByLabel(/^Name/).fill(`Renamed ${code}`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Updated')).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(`Renamed ${code}`) })).toBeVisible();

    // delete (native confirm dialog)
    page.once('dialog', (d) => d.accept());
    await page.getByRole('row', { name: new RegExp(code) }).getByRole('button').last().click();
    await expect(page.getByText('Deleted')).toBeVisible();
    await expect(page.getByText('0 of 0')).toBeVisible();
  });

  test('sorting the customer grid is done by the server', async ({ page }) => {
    await page.goto('/masters/customers');
    const sorted = page.waitForRequest(
      (r) => r.url().includes('/api/customers') && r.url().includes('sort=name') && r.url().includes('dir=asc')
    );
    await page.getByRole('button', { name: 'Name' }).click();
    await sorted;
  });
});

test.describe('audit log (manager)', () => {
  test('lists recorded activity, paged', async ({ page, request }) => {
    await signIn(page, request, 'manager');
    await page.goto('/audit-log');
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(page.getByText(/1–\d+ of \d+/)).toBeVisible();
  });
});
