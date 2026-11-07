// Requires a real staging login from canto-sign-in.mjs. No master/refresh writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
const state = JSON.parse(fs.readFileSync('tools/canto-sync/private/browser-state.json'));
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const passed = [];
try {
  const page = await browser.newPage();
  const errors = [], productionRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('levwrmvqdntngeasrtnb.supabase.co')) productionRequests.push(request.url()); });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument(state => {
    for (const [key, value] of Object.entries(state.local)) localStorage.setItem(key, value);
    localStorage.setItem('scott-dashboard-env-override', 'staging');
    // Reproduce the screenshot and a stale independently selected refresh target.
    localStorage.setItem('canto:admin-target:v1', JSON.stringify({ source: 'supabase', environment: 'production' }));
    sessionStorage.setItem('canto:refresh-environment', 'production');
  }, state);
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.innerText === 'Masters'), { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const target = await import('/src/canto/target.js');
    const { supabase } = await import('/src/supabaseClient.js');
    let mismatchedDenied = false;
    try { target.getCantoClient('production'); } catch { mismatchedDenied = true; }
    const brands = await target.cantoRpc('masters', { resource: 'authorized_brands', action: 'list', payload: { items: 1 } });
    return { target: target.getCantoTarget(), refresh: target.defaultRefreshEnvironment(), sharedClient: target.getCantoClient() === supabase, mismatchedDenied, hasBrands: brands.data.length > 0 };
  });
  assert.deepEqual(result, { target: { source: 'supabase', environment: 'staging' }, refresh: 'staging', sharedClient: true, mismatchedDenied: true, hasBrands: true });
  passed.push('stale production target uses real staging dashboard session; wrong-project client rejected');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.innerText === 'Masters').click());
  await page.waitForFunction(() => document.querySelector('[aria-label="Data environment"]')?.textContent.includes('Staging'));
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 1 && [...document.querySelectorAll('tbody td')].some(td => td.textContent.trim().length > 0) && !document.querySelector('tbody .animate-pulse'), { timeout: 60000 });
  assert.equal(await page.evaluate(() => document.body.innerText.includes('Connect account') || document.body.innerText.includes('Sign in to production to continue')), false);
  await page.screenshot({ path: '/tmp/canto-shared-session-masters.png', fullPage: true });
  passed.push('Masters renders real rows without a second login');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.innerText === 'Data Refresh').click());
  await page.waitForFunction(() => document.body.innerText.includes('Success — verified'), { timeout: 60000 });
  assert.equal(await page.evaluate(() => document.body.innerText.includes('DigitalOcean staging → Supabase staging') && !document.body.innerText.includes('Connect account')), true);
  await page.screenshot({ path: '/tmp/canto-shared-session-refresh.png', fullPage: true });
  await page.reload();
  await page.waitForFunction(() => document.body.innerText.includes('Success — verified'), { timeout: 60000 });
  passed.push('Data Refresh ignores stale production selection and survives reload');
  assert.deepEqual(productionRequests, []);
  assert.deepEqual(errors, []);
  passed.push('no production requests and zero browser exceptions');
  const legacy = await page.evaluate(async () => {
    localStorage.setItem('canto:admin-target:v1', JSON.stringify({ source: 'legacy', environment: 'production' }));
    return (await import('/src/canto/target.js')).getCantoTarget();
  });
  assert.deepEqual(legacy, { source: 'legacy', environment: 'production' });
  passed.push('Old system keeps its independent target');
  // A fresh browser context checks production resolution without reusing staging
  // credentials or querying production application data.
  const context = await browser.createBrowserContext();
  const productionPage = await context.newPage();
  await productionPage.evaluateOnNewDocument(() => {
    localStorage.setItem('scott-dashboard-env-override', 'production');
    localStorage.setItem('canto:admin-target:v1', JSON.stringify({ source: 'supabase', environment: 'staging' }));
  });
  await productionPage.goto('http://127.0.0.1:5173');
  const production = await productionPage.evaluate(async () => {
    const t = await import('/src/canto/target.js');
    const { supabase } = await import('/src/supabaseClient.js');
    let denied = false; try { t.getCantoClient('staging'); } catch { denied = true; }
    return { target: t.getCantoTarget(), refresh: t.defaultRefreshEnvironment(), shared: t.getCantoClient() === supabase, denied };
  });
  assert.deepEqual(production, { target: { source: 'supabase', environment: 'production' }, refresh: 'production', shared: true, denied: true });
  passed.push('production also shares the dashboard client and rejects opposite-project calls');
  console.log(JSON.stringify({ passed }, null, 2));
} finally { await browser.close(); }
