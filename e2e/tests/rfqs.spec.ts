import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_PART, PAGING_COUNT, PAGING_PREFIX, signIn } from './support';

const searchBox = (page: Page) => page.getByPlaceholder('Search RFQ / part…');
const rows = (page: Page) => page.locator('tbody tr');
const firstRfq = (page: Page) => page.locator('tbody tr').first().getByRole('link').innerText();

test.describe('RFQ list — server-side paging, sort and filter', () => {
  test.beforeEach(async ({ page, request }) => {
    await signIn(page, request, 'estimator');
    await page.goto('/rfqs');
    await searchBox(page).fill(PAGING_PREFIX);
    await expect(page.getByText(`1–25 of ${PAGING_COUNT}`)).toBeVisible();
  });

  test('shows one page at a time and asks the server for the next one', async ({ page }) => {
    await expect(rows(page)).toHaveCount(25);
    await expect(page.getByRole('button', { name: 'Prev' })).toBeDisabled();

    const next = page.waitForRequest((r) => /\/api\/rfqs\?/.test(r.url()) && r.url().includes('page=2'));
    await page.getByRole('button', { name: 'Next' }).click();
    await next;

    await expect(page.getByText(`26–${PAGING_COUNT} of ${PAGING_COUNT}`)).toBeVisible();
    await expect(rows(page)).toHaveCount(PAGING_COUNT - 25);
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();

    await page.getByRole('button', { name: 'Prev' }).click();
    await expect(page.getByText(`1–25 of ${PAGING_COUNT}`)).toBeVisible();
  });

  test('changing the page size re-queries the server', async ({ page }) => {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(`26–${PAGING_COUNT}`)).toBeVisible();

    await page.getByText('Rows', { exact: true }).locator('..').getByRole('combobox').selectOption('10');
    await expect(page.getByText(`1–10 of ${PAGING_COUNT}`)).toBeVisible();
    await expect(rows(page)).toHaveCount(10);
    await expect(page.getByText('1 / 3')).toBeVisible();
  });

  test('sorting by RFQ # is done by the server across all pages, and flips on a second click', async ({ page }) => {
    const header = page.getByRole('button', { name: 'RFQ #' });

    const asc = page.waitForRequest((r) => r.url().includes('sort=rfqNumber') && r.url().includes('dir=asc'));
    await header.click();
    await asc;
    await expect.poll(() => firstRfq(page)).toBe(`${PAGING_PREFIX}001`);

    const desc = page.waitForRequest((r) => r.url().includes('sort=rfqNumber') && r.url().includes('dir=desc'));
    await header.click();
    await desc;
    // the LAST RFQ overall now leads — proof the whole result set was sorted, not just the visible page
    await expect.poll(() => firstRfq(page)).toBe(`${PAGING_PREFIX}${String(PAGING_COUNT).padStart(3, '0')}`);
  });

  test('a search narrows the total, and clearing it brings everything back', async ({ page }) => {
    await searchBox(page).fill(`${PAGING_PREFIX}007`);
    await expect(page.getByText('1–1 of 1')).toBeVisible();
    await expect(page.getByRole('link', { name: `${PAGING_PREFIX}007` })).toBeVisible();

    await searchBox(page).fill('nothing-matches-this-zzz');
    await expect(page.getByText('No RFQs yet.')).toBeVisible();
    await expect(page.getByText('0 of 0')).toBeVisible();

    await searchBox(page).fill(PAGING_PREFIX);
    await expect(page.getByText(`1–25 of ${PAGING_COUNT}`)).toBeVisible();
  });

  test('searching from page 2 returns to page 1 instead of showing an empty page', async ({ page }) => {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(`26–${PAGING_COUNT}`)).toBeVisible();
    await searchBox(page).fill(`${PAGING_PREFIX}01`);
    await expect(page.getByText(/^1–\d+ of \d+$/)).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
  });

  test('the status filter only lists matching revisions', async ({ page }) => {
    const status = page.getByRole('combobox').first();
    await status.selectOption('WON'); // none of the fixtures are WON
    await expect(page.getByText('No RFQs yet.')).toBeVisible();
    await status.selectOption('');
    await expect(page.getByText(`1–25 of ${PAGING_COUNT}`)).toBeVisible();
  });
});

test.describe('creating and opening an RFQ', () => {
  const pickFixturePart = async (page: Page) => {
    const dialog = page.getByRole('dialog');
    const select = dialog.locator('#customerPartId');
    const partId = await select.locator('option', { hasText: FIXTURE_PART }).getAttribute('value');
    await select.selectOption(partId!);
    return dialog;
  };

  test('an estimator creates an RFQ by hand and lands on its page', async ({ page, request }) => {
    await signIn(page, request, 'estimator');
    const number = `E2E-NEW-${Date.now()}`;

    await page.goto('/rfqs');
    await page.getByRole('button', { name: 'Manual' }).click();
    const dialog = await pickFixturePart(page);
    await dialog.getByLabel(/RFQ number/).fill(number);
    await dialog.getByLabel('Annual qty').fill('5000');
    await dialog.getByLabel('Batch qty').fill('500');
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('RFQ created')).toBeVisible();
    await expect(page).toHaveURL(/\/rfqs\/\d+$/);
    await expect(page.getByRole('heading', { name: number })).toBeVisible();
    await expect(page.getByText('Revision 1 — part attributes')).toBeVisible();

    // and it is in the list
    await page.goto('/rfqs');
    await searchBox(page).fill(number);
    await expect(page.getByRole('link', { name: number })).toBeVisible();
  });

  test('reusing an RFQ number is refused with a clear message, and nothing is created', async ({ page, request }) => {
    await signIn(page, request, 'estimator');
    await page.goto('/rfqs');
    await page.getByRole('button', { name: 'Manual' }).click();
    const dialog = await pickFixturePart(page);
    await dialog.getByLabel(/RFQ number/).fill(`${PAGING_PREFIX}001`);
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText(/already exists/i)).toBeVisible();
    await expect(dialog).toBeVisible(); // still open, so the number can be corrected
    await expect(page).toHaveURL(/\/rfqs$/);
  });

  test('computing the cost either succeeds or says why not — never a raw server error', async ({ page, request }) => {
    await signIn(page, request, 'estimator');
    await page.goto('/rfqs');
    await searchBox(page).fill(`${PAGING_PREFIX}002`);
    await page.getByRole('link', { name: `${PAGING_PREFIX}002` }).click();
    await expect(page.getByRole('heading', { name: `${PAGING_PREFIX}002` })).toBeVisible();

    await page.getByRole('button', { name: 'Compute cost' }).click();
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible();
    await expect(page.locator('[data-sonner-toast]').first()).not.toContainText(/internal server error|prisma|undefined|\[object/i);
  });
});
