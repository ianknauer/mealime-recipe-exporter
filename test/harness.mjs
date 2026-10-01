// Shared Playwright harness: loads an unpacked extension, mocks Mealime, launches the export page
// bound to a source tab, and (optionally) returns the downloaded zip's files.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const JSZip = require('../vendor/' + (fs.existsSync(new URL('../vendor/jszip.js', import.meta.url)) ? 'jszip.js' : 'jszip.min.js'));

export async function run({ ext, sourceUrl, routes, beforeLaunch, expect = 'done', screenshot }) {
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'prof-')), {
    headless: true, channel: 'chromium', acceptDownloads: true, downloadsPath: dl,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    for (const [pattern, handler] of routes) await ctx.route(pattern, handler);
    let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const id = sw.url().split('/')[2];
    const src = await ctx.newPage();
    await src.goto(sourceUrl);
    if (beforeLaunch) await beforeLaunch(src);
    const probe = await ctx.newPage();
    await probe.goto(`chrome-extension://${id}/export.html`);
    const host = new URL(sourceUrl).host;
    const tabId = await probe.evaluate(async (h) => {
      const tabs = await chrome.tabs.query({});
      return (tabs.find((t) => t.url && new URL(t.url).host === h) || tabs.find((t) => !t.url)).id;
    }, host);
    await probe.close();
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/export.html?tab=${tabId}`);
    const result = { errors };
    if (expect === 'done') {
      await page.waitForFunction(() => !document.getElementById('go').disabled, null, { timeout: 20000 });
      result.ready = await page.textContent('#ready');
      const dlP = page.waitForEvent('download', { timeout: 60000 });
      await page.click('#go');
      await page.waitForSelector('#done:not([hidden])', { timeout: 60000 });
      result.message = await page.textContent('#donemsg');
      const d = await dlP;
      result.zipName = d.suggestedFilename();
      const zip = await JSZip.loadAsync(fs.readFileSync(await d.path()));
      result.files = {};
      for (const n of Object.keys(zip.files).filter((n) => !n.endsWith('/'))) result.files[n] = await zip.file(n).async('nodebuffer');
    } else {
      await page.waitForSelector('#error:not([hidden])', { timeout: 20000 });
      result.message = await page.textContent('#errmsg');
    }
    if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
    return result;
  } finally { await ctx.close(); }
}

export function dump(files, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [n, b] of Object.entries(files)) { const p = path.join(dir, n); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, b); }
}
