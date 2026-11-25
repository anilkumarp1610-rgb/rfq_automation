# Test info

- Name: Test Drawings folder >> is for people who can work on RFQs — a viewer neither sees nor reaches it
- Location: D:\AV Projects\rfq_automation\e2e\tests\drawings.spec.ts:10:7

# Error details

```
Error: browserType.launch: Executable doesn't exist at C:\Users\AV\AppData\Local\ms-playwright\chromium_headless_shell-1169\chrome-win\headless_shell.exe
╔═════════════════════════════════════════════════════════════════════════╗
║ Looks like Playwright Test or Playwright was just installed or updated. ║
║ Please run the following command to download new browsers:              ║
║                                                                         ║
║     npx playwright install                                              ║
║                                                                         ║
║ <3 Playwright Team                                                      ║
╚═════════════════════════════════════════════════════════════════════════╝
```

# Test source

```ts
   1 | import { expect, test, type Page } from '@playwright/test';
   2 | import { drawingPdf } from '../../apps/api/src/test-support/pdf';
   3 | import { signIn } from './support';
   4 |
   5 | const PDF = Buffer.from('%PDF-1.4\n%fake drawing for the browser tests\n');
   6 | const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: PDF });
   7 | const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });
   8 |
   9 | test.describe('Test Drawings folder', () => {
>  10 |   test('is for people who can work on RFQs — a viewer neither sees nor reaches it', async ({ page, request }) => {
      |       ^ Error: browserType.launch: Executable doesn't exist at C:\Users\AV\AppData\Local\ms-playwright\chromium_headless_shell-1169\chrome-win\headless_shell.exe
   11 |     await signIn(page, request, 'viewer');
   12 |     await page.goto('/');
   13 |     await expect(page.getByRole('link', { name: 'Test Drawings' })).toHaveCount(0);
   14 |     await page.goto('/test-drawings');
   15 |     await expect(page).toHaveURL(/\/$/);
   16 |   });
   17 |
   18 |   test('upload several drawings, analyse them, compare, and delete', async ({ page, request }) => {
   19 |     await signIn(page, request, 'estimator');
   20 |     const stamp = Date.now();
   21 |     const a = `E2E-${stamp}-first.pdf`;
   22 |     const b = `E2E-${stamp}-second.pdf`;
   23 |
   24 |     await page.goto('/');
   25 |     await page.getByRole('link', { name: 'Test Drawings' }).click();
   26 |     await expect(page.getByRole('heading', { name: 'Test Drawings' })).toBeVisible();
   27 |
   28 |     // the page says up front what a click will do — in the browser-test setup that is the sample stub
   29 |     await expect(page.getByText(/Sample mode — values are NOT read from your files/)).toBeVisible();
   30 |
   31 |     // upload two PDFs and one file type that is refused
   32 |     await page.getByTestId('test-drawing-input').setInputFiles([
   33 |       pdf(a),
   34 |       pdf(b),
   35 |       { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a drawing') },
   36 |     ]);
   37 |     await expect(row(page, a)).toBeVisible();
   38 |     await expect(row(page, b)).toBeVisible();
   39 |     await expect(page.getByText('Not uploaded')).toBeVisible();
   40 |     await expect(page.getByText(/notes\.txt — only PDF or image files/)).toBeVisible();
   41 |     await expect(row(page, a)).toContainText('not analyzed');
   42 |
   43 |     // analyse one: its row fills in and says plainly that it is sample data
   44 |     await row(page, a).getByRole('button', { name: 'Analyze' }).click();
   45 |     await expect(row(page, a)).toContainText('sample data');
   46 |     await expect(row(page, a)).toContainText('SAMPLE SHAFT');
   47 |     await expect(row(page, b)).toContainText('not analyzed');
   48 |
   49 |     // analyse the other: two different files with identical values must be called out
   50 |     await row(page, b).getByRole('button', { name: 'Analyze' }).click();
   51 |     await expect(row(page, b)).toContainText('sample data');
   52 |     await expect(page.getByText('Different files returned identical values')).toBeVisible();
   53 |
   54 |     // the details panel shows what was read
   55 |     await page.getByRole('button', { name: a, exact: true }).click();
   56 |     await expect(page.getByText('Sample data — not read from this file')).toBeVisible();
   57 |     await expect(page.getByText(/Items read \(\d+\)/)).toBeVisible();
   58 |     await page.getByRole('button', { name: 'Close details' }).click();
   59 |
   60 |     // results survive a reload (stored next to the file)
   61 |     await page.reload();
   62 |     await expect(row(page, a)).toContainText('sample data');
   63 |
   64 |     // delete both
   65 |     for (const name of [a, b]) {
   66 |       page.once('dialog', (d) => d.accept());
   67 |       await page.getByRole('button', { name: `Delete ${name}` }).click();
   68 |       await expect(row(page, name)).toHaveCount(0);
   69 |     }
   70 |   });
   71 |
   72 |   test('"Read text" reads a real PDF for free — item name and grade from its own title block', async ({ page, request }) => {
   73 |     await signIn(page, request, 'estimator');
   74 |     const stamp = Date.now();
   75 |     const shaft = `E2E-${stamp}-shaft.pdf`;
   76 |     const bush = `E2E-${stamp}-bush.pdf`;
   77 |
   78 |     await page.goto('/test-drawings');
   79 |     await page.getByTestId('test-drawing-input').setInputFiles([
   80 |       { name: shaft, mimeType: 'application/pdf', buffer: await drawingPdf({ title: 'SHAFT 26 X 84 LONG', material: 'EN24', drawingNo: 'P01273550' }) },
   81 |       { name: bush, mimeType: 'application/pdf', buffer: await drawingPdf({ title: 'BUSH 40 X 60 LONG', material: 'SS316', drawingNo: 'P09999111' }) },
   82 |     ]);
   83 |     await expect(row(page, shaft)).toBeVisible();
   84 |
   85 |     for (const name of [shaft, bush]) await row(page, name).getByRole('button', { name: 'Read text' }).click();
   86 |
   87 |     // each row shows what ITS file says, and says it came from the PDF text rather than the AI
   88 |     await expect(row(page, shaft)).toContainText('SHAFT 26 X 84 LONG');
   89 |     await expect(row(page, shaft)).toContainText('EN24');
   90 |     await expect(row(page, shaft)).toContainText('P01273550');
   91 |     await expect(row(page, shaft)).toContainText('read from PDF text');
   92 |     await expect(row(page, bush)).toContainText('BUSH 40 X 60 LONG');
   93 |     await expect(row(page, bush)).toContainText('SS316');
   94 |     await expect(page.getByText('Different files returned identical values')).toHaveCount(0);
   95 |
   96 |     await page.getByRole('button', { name: shaft, exact: true }).click();
   97 |     await expect(page.getByText(/Read from the PDF's own text \(no AI\)/)).toBeVisible();
   98 |     await expect(page.getByText(/no AI was used/)).toBeVisible();
   99 |     await page.getByRole('button', { name: 'Close details' }).click();
  100 |
  101 |     for (const name of [shaft, bush]) {
  102 |       page.once('dialog', (d) => d.accept());
  103 |       await page.getByRole('button', { name: `Delete ${name}` }).click();
  104 |       await expect(row(page, name)).toHaveCount(0);
  105 |     }
  106 |   });
  107 | });
  108 |
```