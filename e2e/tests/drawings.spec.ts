import { expect, test, type Page } from '@playwright/test';
import { drawingPdf } from '../../apps/api/src/test-support/pdf';
import { signIn } from './support';

const PDF = Buffer.from('%PDF-1.4\n%fake drawing for the browser tests\n');
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: PDF });
const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });

test.describe('Test Drawings folder', () => {
  test('is for people who can work on RFQs — a viewer neither sees nor reaches it', async ({ page, request }) => {
    await signIn(page, request, 'viewer');
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Test Drawings' })).toHaveCount(0);
    await page.goto('/test-drawings');
    await expect(page).toHaveURL(/\/$/);
  });

  test('upload several drawings, analyse them, compare, and delete', async ({ page, request }) => {
    await signIn(page, request, 'estimator');
    const stamp = Date.now();
    const a = `E2E-${stamp}-first.pdf`;
    const b = `E2E-${stamp}-second.pdf`;

    await page.goto('/');
    await page.getByRole('link', { name: 'Test Drawings' }).click();
    await expect(page.getByRole('heading', { name: 'Test Drawings' })).toBeVisible();

    // the page says up front what a click will do — in the browser-test setup that is the sample stub
    await expect(page.getByText(/Sample mode — values are NOT read from your files/)).toBeVisible();

    // upload two PDFs and one file type that is refused
    await page.getByTestId('test-drawing-input').setInputFiles([
      pdf(a),
      pdf(b),
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a drawing') },
    ]);
    await expect(row(page, a)).toBeVisible();
    await expect(row(page, b)).toBeVisible();
    await expect(page.getByText('Not uploaded')).toBeVisible();
    await expect(page.getByText(/notes\.txt — only PDF or image files/)).toBeVisible();
    await expect(row(page, a)).toContainText('not analyzed');

    // analyse one: its row fills in and says plainly that it is sample data
    await row(page, a).getByRole('button', { name: 'Analyze' }).click();
    await expect(row(page, a)).toContainText('sample data');
    await expect(row(page, a)).toContainText('SAMPLE SHAFT');
    await expect(row(page, b)).toContainText('not analyzed');

    // analyse the other: two different files with identical values must be called out
    await row(page, b).getByRole('button', { name: 'Analyze' }).click();
    await expect(row(page, b)).toContainText('sample data');
    await expect(page.getByText('Different files returned identical values')).toBeVisible();

    // the details panel shows what was read
    await page.getByRole('button', { name: a, exact: true }).click();
    await expect(page.getByText('Sample data — not read from this file')).toBeVisible();
    await expect(page.getByText(/Items read \(\d+\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Close details' }).click();

    // results survive a reload (stored next to the file)
    await page.reload();
    await expect(row(page, a)).toContainText('sample data');

    // delete both
    for (const name of [a, b]) {
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: `Delete ${name}` }).click();
      await expect(row(page, name)).toHaveCount(0);
    }
  });

  test('"Read text" reads a real PDF for free — item name and grade from its own title block', async ({ page, request }) => {
    await signIn(page, request, 'estimator');
    const stamp = Date.now();
    const shaft = `E2E-${stamp}-shaft.pdf`;
    const bush = `E2E-${stamp}-bush.pdf`;

    await page.goto('/test-drawings');
    await page.getByTestId('test-drawing-input').setInputFiles([
      { name: shaft, mimeType: 'application/pdf', buffer: await drawingPdf({ title: 'SHAFT 26 X 84 LONG', material: 'EN24', drawingNo: 'P01273550' }) },
      { name: bush, mimeType: 'application/pdf', buffer: await drawingPdf({ title: 'BUSH 40 X 60 LONG', material: 'SS316', drawingNo: 'P09999111' }) },
    ]);
    await expect(row(page, shaft)).toBeVisible();

    for (const name of [shaft, bush]) await row(page, name).getByRole('button', { name: 'Read text' }).click();

    // each row shows what ITS file says, and says it came from the PDF text rather than the AI
    await expect(row(page, shaft)).toContainText('SHAFT 26 X 84 LONG');
    await expect(row(page, shaft)).toContainText('EN24');
    await expect(row(page, shaft)).toContainText('P01273550');
    await expect(row(page, shaft)).toContainText('read from PDF text');
    await expect(row(page, bush)).toContainText('BUSH 40 X 60 LONG');
    await expect(row(page, bush)).toContainText('SS316');
    await expect(page.getByText('Different files returned identical values')).toHaveCount(0);

    await page.getByRole('button', { name: shaft, exact: true }).click();
    await expect(page.getByText(/Read from the PDF's own text \(no AI\)/)).toBeVisible();
    await expect(page.getByText(/no AI was used/)).toBeVisible();
    await page.getByRole('button', { name: 'Close details' }).click();

    for (const name of [shaft, bush]) {
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: `Delete ${name}` }).click();
      await expect(row(page, name)).toHaveCount(0);
    }
  });
});
