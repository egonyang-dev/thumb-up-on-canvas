// @ts-check
const { test, expect } = require('@playwright/test');

/* Helpers */
async function clickLike(page) {
  await page.click('#btn-like');
  await page.waitForTimeout(800);
}

async function clickCanvas(page, x, y) {
  await page.click('#viewport', { position: { x, y } });
  await page.waitForTimeout(1300); // zoom animation
}

async function doFullScan(page, drawInsideFrame = false) {
  const vp = page.viewportSize();
  const cx = vp.width / 2, cy = vp.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();

  if (drawInsideFrame) {
    // Draw a small path inside the 110×150 scan frame
    for (let i = 0; i <= 8; i++) {
      await page.mouse.move(cx - 30 + i * 8, cy - 20 + i * 5);
      await page.waitForTimeout(400);
    }
  } else {
    await page.waitForTimeout(3400); // wait for auto-complete sweep
  }

  await page.mouse.up();
  await page.waitForTimeout(1500); // completion flow
}

/* ── Tests ─────────────────────────────────────────────────── */

test('1 — initial prompt is visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#initial-prompt')).toBeVisible();
  await expect(page.locator('#btn-like')).toBeVisible();
  await expect(page.locator('#scan-overlay')).not.toBeVisible();
  await expect(page.locator('#share-panel')).not.toBeVisible();
});

test('2 — Like button starts awaiting_click state', async ({ page }) => {
  await page.goto('/');
  await clickLike(page);
  await expect(page.locator('#initial-prompt')).not.toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'awaiting_click');
  await expect(page.locator('#notification')).toHaveText('Click anywhere.');
});

test('3 — canvas click triggers zoom and scan frame', async ({ page }) => {
  await page.goto('/');
  await clickLike(page);
  const vp = page.viewportSize();
  await clickCanvas(page, vp.width / 2, vp.height / 2);
  await expect(page.locator('#scan-overlay')).toBeVisible();
  await expect(page.locator('#notification')).toHaveText('Press and hold.');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'scanning');
});

test('4 — short press is rejected with "Hold still."', async ({ page }) => {
  await page.goto('/');
  await clickLike(page);
  const vp = page.viewportSize();
  await clickCanvas(page, vp.width / 2, vp.height / 2);
  // Press for only 400ms (below minDuration 1000ms)
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(page.locator('#notification')).toHaveText('Hold still.');
  // Still in scanning state
  await expect(page.locator('body')).toHaveAttribute('data-state', 'scanning');
});

test('5 — full scan generates a thumb mark', async ({ page }) => {
  await page.goto('/');
  await clickLike(page);
  const vp = page.viewportSize();
  await clickCanvas(page, vp.width / 2, vp.height / 2);
  await doFullScan(page);
  const count = await page.locator('.thumb-mark').count();
  expect(count).toBeGreaterThan(0);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'inspecting');
});

test('6 — thumb marks have draggable=false and pointer-events:none', async ({ page }) => {
  await page.goto('/');
  await clickLike(page);
  const vp = page.viewportSize();
  await clickCanvas(page, vp.width / 2, vp.height / 2);
  await doFullScan(page);
  const thumb = page.locator('.thumb-mark').first();
  await expect(thumb).toHaveAttribute('draggable', 'false');
  const pe = await thumb.evaluate(el => getComputedStyle(el).pointerEvents);
  expect(pe).toBe('none');
});

test('7 — share panel appears after scan', async ({ page }) => {
  await page.goto('/');
  await clickLike(page);
  const vp = page.viewportSize();
  await clickCanvas(page, vp.width / 2, vp.height / 2);
  await doFullScan(page);
  await expect(page.locator('#share-panel')).toBeVisible();
  await expect(page.locator('#ig-handle')).toBeVisible();
  await expect(page.locator('#btn-download')).toBeVisible();
});

test('8 — scan with drawing inside frame produces a thumb', async ({ page }) => {
  await page.goto('/');
  await clickLike(page);
  const vp = page.viewportSize();
  await clickCanvas(page, vp.width / 2, vp.height / 2);
  await doFullScan(page, true /* draw inside frame */);
  const count = await page.locator('.thumb-mark').count();
  expect(count).toBeGreaterThan(0);
});

test('9 — share panel dismisses with × button', async ({ page }) => {
  await page.goto('/');
  await clickLike(page);
  const vp = page.viewportSize();
  await clickCanvas(page, vp.width / 2, vp.height / 2);
  await doFullScan(page);
  await page.click('#btn-dismiss-share');
  await expect(page.locator('#share-panel')).not.toBeVisible();
});

test('10 — inspecting state allows wheel zoom', async ({ page }) => {
  await page.goto('/');
  await clickLike(page);
  const vp = page.viewportSize();
  await clickCanvas(page, vp.width / 2, vp.height / 2);
  await doFullScan(page);

  const world = page.locator('#world');
  const before = await world.evaluate(el => el.style.transform);
  await page.mouse.wheel(0, -200); // zoom in
  await page.waitForTimeout(100);
  const after = await world.evaluate(el => el.style.transform);
  expect(before).not.toBe(after);
});
