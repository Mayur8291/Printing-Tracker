import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../../../..', 'output/scott-one-ui-kit');
fs.mkdirSync(output, { recursive: true });
const tokens = JSON.parse(fs.readFileSync(path.join(root, 'tokens.json'), 'utf8'));
const report = { checks: [], contrast: [], viewport: [], errors: [] };
function luminance(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function checkContrast(name, foreground, background, threshold = 4.5) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a), ratio = (values[0] + 0.05) / (values[1] + 0.05);
  report.contrast.push({ name, foreground, background, ratio: Number(ratio.toFixed(2)), threshold });
  assert(ratio >= threshold, `${name}: ${ratio.toFixed(2)} < ${threshold}`);
}
for (const [name, skin] of Object.entries(tokens.skins)) {
  for (const bg of ['canvas', 'paper', 'soft']) {
    checkContrast(`${name} body on ${bg}`, skin.ink, skin[bg]);
    checkContrast(`${name} secondary on ${bg}`, skin.textSecondary, skin[bg]);
    checkContrast(`${name} control border on ${bg}`, tokens.color.controlBorder, skin[bg], 3);
  }
  checkContrast(`${name} action`, '#FFFFFF', skin.accent);
}
for (const [name, fg, bg] of [['success', 'successInk', 'successFill'], ['warning', 'warning', 'warningFill'], ['danger', 'danger', 'dangerFill'], ['brand', 'white', 'brand'], ['inverse metadata', 'inverseMuted', 'ink']]) checkContrast(name, tokens.color[fg], tokens.color[bg]);
report.checks.push('55 semantic text, status, inverse and control contrast pairs pass their AA thresholds');

const browser = await puppeteer.launch({ executablePath: process.env.SC1_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('requestfailed', request => report.errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.setViewport({ width: 1440, height: 1080, deviceScaleFactor: 1 });
  await page.goto(process.env.SC1_KIT_URL || 'http://127.0.0.1:5198/scott-one-ui-kit.html', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.kit-hero .sc1-order');
  assert.equal(await page.title(), 'Scott One — UI Foundation');
  await page.screenshot({ path: path.join(output, 'desktop-overview.png') });
  await page.screenshot({ path: path.join(output, 'desktop-full.png'), fullPage: true });

  // Search exercises all requested identity kinds, partial matches, case folding and multiple terms.
  const search = '#patterns input[type=search]';
  async function query(text, count) {
    await page.$eval(search, el => { el.focus(); el.select(); });
    await page.keyboard.press('Backspace');
    await page.type(search, text);
    await page.waitForFunction(expected => document.querySelectorAll('#patterns .sc1-order').length === expected, {}, count);
  }
  await query('northstar', 1); await query('HORIZON', 2); await query('summit', 2); await query('63365', 1); await query('north uniform', 1); await query('no-such-person', 0);
  assert(await page.$('#patterns .sc1-empty'));
  await page.click('#patterns .sc1-empty button');
  assert.equal(await page.$$eval('#patterns .sc1-order', nodes => nodes.length), 3);
  await page.click('#patterns input[value="Completed"]');
  assert.equal(await page.$$eval('#patterns .sc1-order', nodes => nodes.length), 1);
  await page.click('#patterns input[value="all"]');
  report.checks.push('Order demo searches customer, dealer, distributor, number and partial multi-word names; status filters and empty recovery work');

  const open = '.kit-hero button[aria-label="View order 63370"]';
  await page.click(open);
  await page.waitForSelector('dialog[open]');
  assert.equal(await page.$eval('dialog', el => el.getAttribute('aria-labelledby') !== null), true);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), 'Modal focus escaped');
  }
  await page.screenshot({ path: path.join(output, 'desktop-sheet.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.$('dialog[open]'), null);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'View order 63370');
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  report.checks.push('Sheet opens, contains keyboard focus, closes with Escape and restores opener and scrolling');

  await page.focus('[role=tab][aria-selected=true]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval('[role=tab][aria-selected=true]', el => el.textContent), 'Colour');
  await page.keyboard.press('End');
  assert.equal(await page.$eval('[role=tab][aria-selected=true]', el => el.textContent), 'Sizes');
  await page.keyboard.press('Home');
  assert.equal(await page.$eval('[role=tab][aria-selected=true]', el => el.textContent), 'Style');
  await page.click('.kit-options input[value="crew"]');
  assert.equal(await page.$eval('.kit-options input[value="crew"]', el => el.checked), true);
  await page.click('.sc1-switch');
  assert.equal(await page.$eval('[role=switch]', el => el.checked), false);
  assert.equal(await page.$eval('.sc1-button[aria-busy=true]', el => el.disabled), true);
  report.checks.push('Tab keyboard navigation, radio selection, switch and loading-disabled state work');

  await page.click('.kit-auth-form button[type=submit]');
  assert.equal(await page.$eval('.kit-auth-form input[type=email]', el => el.getAttribute('aria-invalid')), 'true');
  const linkedError = await page.$eval('.kit-auth-form input[type=email]', el => el.getAttribute('aria-describedby'));
  assert(await page.evaluate(id => document.getElementById(id)?.textContent.includes('valid email'), linkedError));
  await page.type('.kit-auth-form input[type=email]', 'demo@example.test');
  await page.click('.kit-auth-form button[type=submit]');
  assert.equal(await page.$eval('.kit-auth-form input[type=email]', el => el.getAttribute('aria-invalid')), null);
  await page.click('button[aria-label="Dismiss message"]');
  report.checks.push('Auth demo associates visible validation errors and clears them after correction without sending credentials');

  await page.evaluate(() => { const el = document.createElement('button'); el.id = 'scope-probe'; el.textContent = 'Outside kit'; document.body.append(el); });
  const outside = await page.$eval('#scope-probe', el => ({ radius: getComputedStyle(el).borderRadius, token: getComputedStyle(el).getPropertyValue('--sc1-canvas') }));
  assert.equal(outside.token, ''); assert.equal(outside.radius, '0px');
  await page.$eval('#scope-probe', el => el.remove());
  report.checks.push('Component import leaves elements outside .sc1 unthemed');

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(dimensions.scroll <= width + 1, `Horizontal page overflow at ${width}: ${dimensions.scroll}`);
    report.viewport.push(dimensions);
    if (width === 390 || width === 320) {
      await page.screenshot({ path: path.join(output, `mobile-${width}.png`) });
      await page.$eval('#patterns', el => el.scrollIntoView());
      await page.screenshot({ path: path.join(output, `orders-${width}.png`) });
      await page.click('#patterns button[aria-label="View order 63370"]');
      await page.waitForSelector('dialog[open]');
      const box = await page.$eval('dialog', el => ({ width: el.getBoundingClientRect().width, bottom: el.getBoundingClientRect().bottom }));
      assert(box.width <= width + 1); assert(box.bottom <= 1001);
      await page.screenshot({ path: path.join(output, `sheet-${width}.png`) });
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewport({ width: 768, height: 1000 });
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Overflow at 200% text');
  await page.screenshot({ path: path.join(output, 'text-200.png') });
  await page.evaluate(() => document.documentElement.style.fontSize = '');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  assert.equal(await page.$eval('.sc1-spinner', el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.$eval('.sc1-skeleton > span:last-child', el => getComputedStyle(el, '::after').animationName), 'none');
  report.checks.push('No page overflow at 320, 390, 768, 1024, 1440; 200% root text reflows; mobile sheet fits; reduced motion is static');
  assert.deepEqual(report.errors, [], 'Browser console/network errors');
  report.checks.push('No browser console, runtime or failed-request errors');
} finally {
  await browser.close();
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: report.checks, contrastPairs: report.contrast.length, output }, null, 2));
