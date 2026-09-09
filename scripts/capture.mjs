import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openBrowser } from './browser-helpers.mjs';
const app = await openBrowser(), { page } = app;
try {
  await mkdir('examples', { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1220 });
  await page.locator('[data-field="compare"]').check();
  await page.locator('[data-brush="inspect"]').click();
  await page.locator('[data-cell="29"]').click();
  await page.locator('[data-action="step"]').click();
  await page.locator('[data-action="step"]').click();
  await page.locator('[data-action="step"]').click();
  await page.locator('.teach-pet').screenshot({ path: 'examples/garden-comparison.png', animations: 'disabled' });
  await page.locator('[data-field="preset"]').selectOption('crossroads');
  await page.locator('[data-field="compare"]').uncheck();
  await page.locator('[data-view="value"]').click();
  await page.locator('[data-field="seed"]').fill('2026');
  await page.locator('[data-action="train"]').click();
  await expect(page.locator('[data-output="training-status"]')).toContainText('Lesson complete', { timeout: 20000 });
  await page.locator('[data-cell="40"]').click();
  await page.locator('[data-action="step"]').click();
  await page.locator('[data-action="step"]').click();
  await page.locator('.teach-pet').screenshot({ path: 'examples/crossroads-values.png', animations: 'disabled' });
  console.log('Captured examples/garden-comparison.png and examples/crossroads-values.png from the real mounted UI.');
} finally { await app.close(); }
