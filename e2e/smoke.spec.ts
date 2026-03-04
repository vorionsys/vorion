import { test, expect } from '@playwright/test';

/**
 * Smoke tests -- verify critical pages load and render.
 *
 * These run on every PR to catch deployment-breaking changes early.
 */

test.describe('Smoke Tests', () => {
  test('homepage loads and renders navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
    await expect(page.locator('nav').first()).toBeVisible();
  });

  test('page has no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test('responds to viewport changes (responsive)', async ({ page }) => {
    await page.goto('/');
    // Desktop
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.locator('body')).toBeVisible();
    // Mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('body')).toBeVisible();
  });
});
