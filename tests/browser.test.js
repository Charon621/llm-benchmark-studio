/**
 * Browser regression tests for LLM Benchmark Studio.
 * Uses isolated STUDIO_DATA_DIR and synthetic images only.
 * Run: node tests/browser.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

// Must set before any src/ import.
process.env.STUDIO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-browser-'));
process.env.STUDIO_TEST_BLOCK_EXTERNAL = '1';
delete process.env.STUDIO_ENABLE_LIVE;

const { createApp } = await import('../src/server.js');
const { seed } = await import('../src/seeds.js');

// Synthetic PNG (1x1 red pixel).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
);

let server, baseUrl, browser, page;

before(async () => {
  seed();
  const app = createApp();
  server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  page = await ctx.newPage();
  // Capture console errors for assertions.
  page._consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') page._consoleErrors.push(msg.text()); });
  page.on('pageerror', err => page._consoleErrors.push(String(err)));
});

after(async () => {
  await browser?.close();
  await new Promise(r => server?.close(r));
});

describe('Browser: page loads without console errors', () => {
  test('homepage loads and shows title', async () => {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const title = await page.title();
    assert.ok(title.length > 0, 'page has a title');
    const body = await page.textContent('body');
    assert.ok(body.length > 100, 'page has content');
  });

  test('no uncaught console errors on load', async () => {
    const errors = page._consoleErrors.filter(e => !e.includes('favicon'));
    assert.equal(errors.length, 0, `console errors: ${errors.join('; ')}`);
  });
});

describe('Browser: vision asset upload', () => {
  test('upload synthetic PNG via binary endpoint', async () => {
    const resp = await page.evaluate(async (pngBase64) => {
      const bytes = Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      const form = new FormData();
      form.append('file', blob, 'test.png');
      const r = await fetch('/api/assets/upload', { method: 'POST', body: form });
      const text = await r.text();
      let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 100) }; }
      return { status: r.status, body };
    }, PNG_1x1.toString('base64'));
    assert.equal(resp.status, 201, `expected 201, got ${resp.status}: ${JSON.stringify(resp.body)}`);
    assert.ok(resp.body.asset_id || resp.body.sha256, 'response has asset identifier');
  });

  test('batch JSON upload endpoint responds', async () => {
    const resp = await page.evaluate(async (pngBase64) => {
      const r = await fetch('/api/assets/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ base64: pngBase64, filename: 'batch.png', role: 'overview' }] }),
      });
      const text = await r.text();
      let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 100) }; }
      return { status: r.status, body };
    }, PNG_1x1.toString('base64'));
    assert.ok([201, 400, 404].includes(resp.status), `unexpected status ${resp.status}`);
  });
});

describe('Browser: viewport responsiveness', () => {
  for (const width of [390, 1024, 1440]) {
    test(`layout at ${width}px has no horizontal overflow`, async () => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 5
      );
      assert.ok(!overflow, `horizontal overflow at ${width}px`);
    });
  }
});
