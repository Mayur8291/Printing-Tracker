// Exercise the built app with one normal dashboard login, without Vite imports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
const fixture = JSON.parse(fs.readFileSync('tools/canto-sync/private/admin-test.json'));
assert.equal(fixture.url, 'https://scvojtvgnkmbupvyslmb.supabase.co');
const url = process.env.CANTO_TEST_URL || 'http://127.0.0.1:5173';
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  const errors = [], wrongProject = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.url().includes('levwrmvqdntngeasrtnb.supabase.co')) wrongProject.push(r.url()); });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('scott-dashboard-env-override', 'staging');
    localStorage.setItem('canto:admin-target:v1', JSON.stringify({ source: 'supabase', environment: 'production' }));
    sessionStorage.setItem('canto:refresh-environment', 'production');
  });
  await page.goto(url);
  await page.waitForSelector('#login-email');
  await page.type('#login-email', fixture.email);
  await page.type('#login-password', fixture.password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.innerText === 'Masters'), { timeout: 60000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.innerText === 'Masters').click());
  await page.waitForFunction(() => document.querySelector('[aria-label="Data environment"]')?.textContent.includes('Uses dashboard environment'), { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 1 && [...document.querySelectorAll('tbody td')].some(td => td.textContent.trim()) && !document.querySelector('tbody .animate-pulse'), { timeout: 60000 });
  assert.equal(await page.evaluate(() => document.body.innerText.includes('Connect account') || document.body.innerText.includes('Sign in to production')), false);
  await page.screenshot({ path: '/tmp/canto-hosted-shared-session.png', fullPage: true });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.innerText === 'Data Refresh').click());
  await page.waitForFunction(() => document.body.innerText.includes('Success — verified') && document.body.innerText.includes('DigitalOcean staging → Supabase staging'), { timeout: 60000 });
  await page.reload();
  await page.waitForFunction(() => document.body.innerText.includes('Success — verified'), { timeout: 60000 });
  assert.deepEqual(wrongProject, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ url, singleDashboardLogin: true, masterRowsLoaded: true, refreshHistoryLoaded: true, reloadPassed: true, wrongProjectRequests: 0, browserErrors: 0 }));
} finally { await browser.close(); }
