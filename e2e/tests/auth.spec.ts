import { expect, test } from '@playwright/test';
import { PASSWORD, emailOf, setActive, signIn } from './support';

test.describe('sign in / sign out', () => {
  test('a signed-out visitor is sent to the login page from any protected page', async ({ page }) => {
    for (const path of ['/', '/rfqs', '/customer-parts', '/audit-log']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
    await expect(page.getByText('Sign in to your account')).toBeVisible();
  });

  test('a wrong password shows the server error and keeps you on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(emailOf('estimator'));
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });

  test('bad input is caught in the form, without calling the API', async ({ page }) => {
    let loginCalls = 0;
    page.on('request', (r) => {
      if (r.url().endsWith('/auth/login')) loginCalls++;
    });
    await page.goto('/login');
    await page.getByLabel('Email').fill('user@localhost') // the browser accepts this; the form's own rule does not;
    await page.getByLabel('Password').fill('123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid email address')).toBeVisible();
    await expect(page.getByText('Password must be at least 6 characters')).toBeVisible();
    expect(loginCalls).toBe(0);
  });

  test('signing in lands on the dashboard; logging out locks the app again', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(emailOf('estimator'));
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Win rate')).toBeVisible();

    // the session survives a reload
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // the user menu shows who is signed in, then logs out
    await page.getByRole('button', { name: /E2E ESTIMATOR/ }).click();
    await expect(page.getByText(emailOf('estimator'))).toBeVisible();
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();

    await page.goto('/rfqs');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a deactivated user is locked out on their very next request, token or not', async ({ page, request }) => {
    await signIn(page, request, 'leaver'); // a perfectly valid, unexpired token
    await page.goto('/rfqs');
    await expect(page.getByRole('heading', { name: 'RFQs' })).toBeVisible();

    await setActive(request, emailOf('leaver'), false);
    try {
      await page.reload();
      await expect(page).toHaveURL(/\/login$/); // 401 from the API -> the app drops the session
      expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
    } finally {
      await setActive(request, emailOf('leaver'), true);
    }
  });
});
