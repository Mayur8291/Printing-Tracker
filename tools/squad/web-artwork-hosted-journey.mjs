/** Read-only real-source artwork acceptance. No fixture artwork, response mocks,
 * raw table queries, uploads, saved designs or orders. Parent owns the Customer
 * session and runs this BEFORE closing that disposable account.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const preview = '.squad-configurator-preview';
const timeout = 40_000;
const validColor = value => /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(value || '');
const mutation = /(?:_save|_delete|_archive|_transition|_place|_cancel|_retry|_configure|_resolve|_close)$/;

async function select(page, label, value) {
  const find = label => [...document.querySelectorAll('main label')].find(node => node.textContent.trim().replace(/\s*\*$/, '') === label)?.htmlFor;
  await page.waitForFunction(find, { timeout }, label);
  const id = await page.evaluate(find, label);
  for (let pages = 0; pages < 20; pages++) {
    await page.waitForFunction(id => !document.getElementById(id).closest('.space-y-2')?.textContent.includes('Loading choices…'), { timeout }, id);
    if (await page.evaluate((id, value) => [...document.getElementById(id).options].some(option => option.value === value), id, String(value))) {
      const handle = await page.evaluateHandle(id => document.getElementById(id), id);
      try { await handle.asElement().select(String(value)); } finally { await handle.dispose(); }
      return;
    }
    const more = await page.evaluateHandle(id => document.getElementById(id).closest('.space-y-2')?.querySelectorAll('button:not(:disabled)') ? [...document.getElementById(id).closest('.space-y-2').querySelectorAll('button:not(:disabled)')].find(button => button.textContent.trim() === 'More options') : null, id);
    const text = await more.evaluate(node => node?.textContent.trim());
    if (text === 'More options') { await more.asElement().click(); await more.dispose(); await page.waitForNetworkIdle({ idleTime: 150, timeout: 5000 }).catch(() => {}); }
    else { await more.dispose(); await page.waitForFunction((id, value) => [...document.getElementById(id).options].some(option => option.value === value), { timeout }, id, String(value)); }
  }
  throw new Error(`Selected source option was not reachable: ${label}`);
}

async function openProduct(ctx, page, product) {
  await page.goto(`${ctx.base}/squad/catalogue`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[aria-label="Search products"]');
  await page.type('input[aria-label="Search products"]', product.name);
  await page.click('button[aria-label="Search"]');
  await page.waitForFunction(id => [...document.querySelectorAll('main article')].some(article => [...article.querySelectorAll('span')].some(node => node.textContent.trim() === `#${id}`)), { timeout }, product.id);
  const handle = await page.evaluateHandle(id => [...document.querySelectorAll('main article')].find(article => [...article.querySelectorAll('span')].some(node => node.textContent.trim() === `#${id}`))?.querySelector('button'), product.id);
  try { await handle.asElement().click(); } finally { await handle.dispose(); }
  await page.waitForSelector(preview);
}

async function settled(page, expectImages = true) {
  await page.waitForFunction((selector, expectImages) => {
    const section = document.querySelector(selector), canvas = section?.querySelector('[role="img"]');
    if (!canvas || canvas.getAttribute('aria-busy') === 'true') return false;
    const images = [...canvas.querySelectorAll('img')];
    return expectImages ? images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0 && !image.hidden) : true;
  }, { timeout }, preview, expectImages);
}

async function inspectArtwork(page, source, color, asset) {
  return page.evaluate(async ({ selector, source, color, asset }) => {
    const section = document.querySelector(selector), container = section.querySelector('[role="img"]');
    const images = [...container.querySelectorAll('img')];
    const image = images[0]; await image.decode();
    const documentOf = text => new DOMParser().parseFromString(text, 'image/svg+xml');
    const original = documentOf(source), output = documentOf(await (await fetch(image.src)).text());
    const attrs = document => [...document.querySelectorAll('*')].flatMap(node => [...node.attributes].filter(attr => ['fill', 'stroke', 'stop-color', 'style'].includes(attr.name)).map(attr => attr.value));
    const originalPaint = attrs(original), currentPaint = attrs(output);
    const whites = values => values.reduce((n, value) => n + [...value.matchAll(/(^|[\s:;(])(white|#ffffff|#fff)(?=$|[\s;)])/gi)].length, 0);
    const pathGeometry = document => [...document.querySelectorAll('path')].map(node => node.getAttribute('d'));
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const context = canvas.getContext('2d');
    for (const layer of images) {
      await layer.decode();
      const height = parseFloat(layer.style.height) / 100 * 512, width = height * layer.naturalWidth / layer.naturalHeight;
      const x = parseFloat(layer.style.left) / 100 * 512, y = parseFloat(layer.style.top) / 100 * 512;
      context.save(); if (layer.style.transform === 'scaleX(-1)') { context.translate(x + width, y); context.scale(-1, 1); context.drawImage(layer, 0, 0, width, height); } else context.drawImage(layer, x, y, width, height); context.restore();
    }
    const rgba = context.getImageData(0, 0, 512, 512).data; let painted = 0;
    for (let index = 3; index < rgba.length; index += 4) if (rgba[index] > 0) painted++;
    return {
      images: images.length, allBlob: images.every(image => image.src.startsWith('blob:')), decoded: images.every(image => image.complete && image.naturalWidth > 0),
      originalWhitePaints: whites(originalPaint), remainingWhitePaints: whites(currentPaint),
      selectedColorPresent: currentPaint.some(value => value.toLowerCase().includes(color.toLowerCase())),
      pathsUnchanged: JSON.stringify(pathGeometry(original)) === JSON.stringify(pathGeometry(output)),
      geometry: { left: image.style.left, top: image.style.top, height: image.style.height },
      expectedGeometry: { left: `${Number(asset.offset_x || 0) * 100}%`, top: `${Number(asset.offset_y || 0) * 100}%`, height: `${100 / Number(asset.height_ratio)}%` },
      paintedPixels: painted, canvasWidth: container.clientWidth, canvasHeight: container.clientHeight,
      inlineSvg: container.querySelectorAll('svg').length, incomplete: section.textContent.includes('This preview is incomplete'),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  }, { selector: preview, source, color, asset });
}

export async function runJourney(ctx) {
  assert.match(ctx.base, /^http:\/\/localhost:\d+$/);
  const entry = (ctx.clientsMap ?? ctx.clients).get(3), sdk = entry.sdk;
  assert.equal(String(entry.me.id), String(ctx.fixture.actors['3']));
  assert.equal(entry.me.capabilities.configure, true);
  const obtained = await ctx.pageFor(3), page = obtained.page ?? obtained;
  const directory = path.resolve('tools/squad/private', `web-artwork-${String(ctx.runId ?? ctx.fixture.run_id ?? Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_')}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
  const report = { scope: 'Read-only real staging source artwork through Customer catalogue UI', checks: [], candidates: [], coverage: {}, screenshotsPrivate: true };
  const badRequests = [], errors = [];
  const onRequest = request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/rest/v1/') && !url.pathname.startsWith('/rest/v1/rpc/')) badRequests.push('raw_table_transport');
    if (url.pathname.startsWith('/rest/v1/rpc/') && mutation.test(url.pathname.split('/').at(-1))) badRequests.push('unexpected_mutation');
    if (url.hostname.endsWith('.supabase.co') && url.hostname !== 'scvojtvgnkmbupvyslmb.supabase.co') badRequests.push('cross_environment_request');
    if (/^(?:https?:)$/.test(url.protocol) && !['localhost', '127.0.0.1', 'scvojtvgnkmbupvyslmb.supabase.co'].includes(url.hostname)) badRequests.push(`unexpected_external_host:${url.hostname}`);
  };
  const onError = error => errors.push(error.name);
  page.on('request', onRequest); page.on('pageerror', onError);
  const screenshot = async name => { const filename = path.join(directory, `${name}.png`); await page.screenshot({ path: filename }); fs.chmodSync(filename, 0o600); return filename; };
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`${ctx.base}/squad/catalogue`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[aria-label="Search products"]');
    let cursor = null, selected = null, missing = null;
    // Explicit bounds keep discovery modest. Never mistake this run's synthetic
    // products for legacy artwork, and never fall back to another environment.
    for (let batch = 0; batch < 3 && !selected; batch++) {
      const products = await sdk.catalogue('products', {}, { cursor, limit: 30 }); cursor = products.next_cursor;
      for (const product of products.data) {
        if (!product.name || /^SQB\b/.test(product.name || '') || product.id === String(ctx.fixture.ids.baseProductId)) continue;
        const assets = await sdk.configuratorOptions(product.id, 'assets', {}, { limit: 100 });
        if (assets.data.length !== 1) { if (!assets.data.length && !missing) missing = product; continue; }
        const asset = assets.data[0];
        if (!asset.asset) continue;
        const grants = await sdk.mediaGrants([asset.asset]); const grant = grants.references?.[0];
        report.candidates.push({ baseId: product.id, assetId: asset.id, mediaStatus: grant?.status, contentType: grant?.content_type });
        if (grant?.status !== 'ready' || grant.content_type !== 'image/svg+xml') continue;
        assert.equal(new URL(grant.url).origin, 'https://scvojtvgnkmbupvyslmb.supabase.co');
        const source = await page.evaluate(async url => { const response = await fetch(url, { credentials: 'omit', redirect: 'error' }); if (!response.ok) throw new Error('Authorized source artwork fetch failed'); const text = await response.text(); if (text.length > 5242880) throw new Error('Source exceeds artwork limit'); return text; }, grant.url);
        if (!/(?:white|#fff(?:fff)?)(?=[\s;"'])/i.test(source)) continue;
        const fabrics = await sdk.configuratorOptions(product.id, 'fabrics', {}, { limit: 50 });
        for (const fabric of fabrics.data.slice(0, 10)) {
          const colors = (await sdk.configuratorOptions(product.id, 'fabric_colors', { parentId: fabric.id }, { limit: 100 })).data;
          const usable = colors.filter(row => validColor(row.hex) && !/^#(?:fff|ffffff)$/i.test(row.hex));
          const distinct = usable.filter((row, index) => usable.findIndex(other => other.hex.toLowerCase() === row.hex.toLowerCase()) === index);
          if (distinct.length >= 2) { selected = { product, asset, source, fabric, colors: distinct.slice(0, 2), unsupported: colors.find(row => row.hex && !validColor(row.hex)) }; break; }
        }
        if (selected) break;
        if (report.candidates.length >= 20) break;
      }
      if (!cursor || report.candidates.length >= 20) break;
    }
    assert.ok(selected, 'No real source product with one ready SVG and two selectable fabric colors found within the bounded audit; inspect candidate evidence');
    const { product, asset, source, fabric, colors } = selected;
    // Private source-only replay artifact: no signed URL, bearer token or identity.
    // This lets the UI lane inspect parser failures without another hosted fixture.
    fs.writeFileSync(path.join(directory, 'selected-source.svg'), source, { mode: 0o600 });
    report.selected = { baseId: product.id, assetId: asset.id, fabricId: fabric.id, colorIds: colors.map(row => row.id) };
    await openProduct(ctx, page, product);
    await select(page, 'Fabric', fabric.id);
    report.renders = [];
    for (const color of colors) {
      await select(page, 'Fabric color', color.id);
      // Wait for the selected paint, not just a previously decoded image left
      // visible while React replaces the old Blob during a color change.
      await page.waitForFunction(async (selector, color) => { const image = document.querySelector(`${selector} [role="img"] img`); if (!image?.src.startsWith('blob:')) return false; try { return (await (await fetch(image.src)).text()).toLowerCase().includes(color.toLowerCase()); } catch { return false; } }, { timeout }, preview, color.hex);
      await settled(page);
      const result = await inspectArtwork(page, source, color.hex, asset);
      assert.ok(result.decoded && result.allBlob && result.paintedPixels > 0 && result.pathsUnchanged && !result.incomplete);
      assert.ok(result.originalWhitePaints > 0 && result.remainingWhitePaints === 0 && result.selectedColorPresent, 'Real base paint must follow the selected fabric color');
      for (const key of ['left', 'top', 'height']) assert.ok(Math.abs(parseFloat(result.geometry[key]) - parseFloat(result.expectedGeometry[key])) < 0.001, `Real Flutter geometry ${key}`);
      assert.equal(result.inlineSvg, 0); assert.equal(result.horizontalOverflow, false);
      report.renders.push({ colorId: color.id, ...result });
    }
    await page.$eval(preview, node => node.scrollIntoView({ block: 'center' }));
    report.desktopScreenshot = await screenshot('real-artwork-desktop');
    report.checks.push('real_source_authorized_svg_decodes_and_composites', 'two_real_fabric_colors_repaint_without_changing_path_geometry', 'source_offsets_and_reciprocal_height_match_flutter');
    await page.setViewport({ width: 390, height: 844 }); await settled(page);
    await page.$eval(preview, node => node.scrollIntoView({ block: 'center' }));
    report.mobile = await inspectArtwork(page, source, colors[1].hex, asset); assert.equal(report.mobile.horizontalOverflow, false); assert.ok(Math.abs(report.mobile.canvasWidth - report.mobile.canvasHeight) <= 1);
    report.mobileScreenshot = await screenshot('real-artwork-mobile');
    const cdp = await page.createCDPSession();
    try { await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 }); report.zoom = await page.evaluate(() => ({ scale: visualViewport.scale, decoded: [...document.querySelectorAll('.squad-configurator-preview img')].every(image => image.complete && image.naturalWidth > 0) })); assert.ok(report.zoom.scale >= 1.9 && report.zoom.decoded); report.zoomScreenshot = await screenshot('real-artwork-mobile-zoom'); }
    finally { await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await cdp.detach(); }
    report.checks.push('real_artwork_responsive_square_and_browser_pinch_zoom_decode');
    report.coverage.baseArtwork = true; report.coverage.recolor = true;
    // Exercise an existing mirrored layer when this real base has one. Selection
    // remains local React state; Add selection does not save a reusable design.
    const parts = (await sdk.configuratorOptions(product.id, 'parts', {}, { limit: 30 })).data;
    let mirrored = null;
    for (const part of parts.slice(0, 3)) {
      const addons = (await sdk.configuratorOptions(product.id, 'addons', { parentId: part.id }, { limit: 50 })).data;
      for (const addon of addons.slice(0, 8)) {
        const layers = (await sdk.configuratorOptions(product.id, 'assets', { parentId: addon.id, partId: part.id }, { limit: 100 })).data;
        if (layers.length !== 1 || !layers[0].asset || layers[0].mirror_offset_x == null || Number(layers[0].mirror_offset_x) === -1) continue;
        const layer = layers[0], grant = (await sdk.mediaGrants([layer.asset])).references[0];
        if (grant.status !== 'ready' || grant.content_type !== 'image/svg+xml') continue;
        const addonColors = (await sdk.configuratorOptions(product.id, 'addon_colors', { parentId: addon.id, partId: part.id }, { limit: 50 })).data;
        mirrored = { part, addon, layer, color: addonColors.find(row => validColor(row.hex)) }; break;
      }
      if (mirrored) break;
    }
    if (mirrored) {
      await page.waitForFunction(name => [...document.querySelectorAll('main label')].some(label => label.textContent.trim() === name && label.querySelector('input[type=checkbox]')), { timeout }, mirrored.part.name);
      const checkbox = await page.evaluateHandle(name => [...document.querySelectorAll('main label')].find(label => label.textContent.trim() === name && label.querySelector('input[type=checkbox]')).querySelector('input'), mirrored.part.name);
      try { await checkbox.asElement().click(); } finally { await checkbox.dispose(); }
      await select(page, 'Add-on', mirrored.addon.id);
      if (mirrored.color) await select(page, 'Add-on color', mirrored.color.id);
      const add = await page.evaluateHandle(() => [...document.querySelectorAll('main button')].find(button => button.textContent.trim() === 'Add selection' && !button.disabled));
      try { await add.asElement().click(); } finally { await add.dispose(); }
      await page.waitForFunction(selector => document.querySelectorAll(`${selector} [role="img"] img`).length === 3, { timeout }, preview);
      await settled(page);
      const layers = await page.$$eval(`${preview} [role="img"] img`, images => images.map(image => ({ left: parseFloat(image.style.left), top: parseFloat(image.style.top), height: parseFloat(image.style.height), transform: image.style.transform, decoded: image.complete && image.naturalWidth > 0 })));
      for (const [index, mirroredLayer] of [[1, false], [2, true]]) {
        assert.equal(layers[index].decoded, true);
        assert.ok(Math.abs(layers[index].left - Number(mirroredLayer ? mirrored.layer.mirror_offset_x : mirrored.layer.offset_x || 0) * 100) < 0.001);
        assert.ok(Math.abs(layers[index].top - Number(mirrored.layer.offset_y || 0) * 100) < 0.001);
        assert.ok(Math.abs(layers[index].height - 100 / Number(mirrored.layer.height_ratio)) < 0.001);
        assert.equal(layers[index].transform, mirroredLayer ? 'scaleX(-1)' : '');
      }
      await page.$eval(preview, node => node.scrollIntoView({ block: 'center' }));
      report.addonScreenshot = await screenshot('real-mirrored-addon-mobile');
      report.coverage.addonMirroring = { partId: mirrored.part.id, addonId: mirrored.addon.id, assetId: mirrored.layer.id, layers };
      report.checks.push('real_addon_and_mirrored_copy_decode_in_source_order_with_source_geometry');
    } else report.coverage.addonMirroring = 'No ready mirrored SVG found in the selected base’s first three parts/eight add-ons each; synthetic geometry tests remain separate';
    if (selected.unsupported) {
      await select(page, 'Fabric color', selected.unsupported.id);
      await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('The selected preview color is not supported'), { timeout }, preview);
      report.coverage.unsupportedSourceColor = { id: selected.unsupported.id, explicit: true };
      report.unsupportedScreenshot = await screenshot('real-unsupported-color');
      await select(page, 'Fabric color', colors[1].id); await settled(page);
    } else report.coverage.unsupportedSourceColor = 'No invalid real color observed among selected fabric options; no synthetic color injected';
    if (missing) {
      await openProduct(ctx, page, missing); await settled(page, false);
      await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('Base garment artwork is unavailable'), { timeout }, preview);
      report.coverage.missingSourceArtwork = { baseId: missing.id, explicit: true };
      report.missingScreenshot = await screenshot('real-missing-artwork');
    } else report.coverage.missingSourceArtwork = 'No missing base encountered within bounded source discovery; no response mocked';
    assert.deepEqual(badRequests, []); assert.deepEqual(errors, []);
    report.checks.push('no_business_mutation_no_legacy_or_cross_environment_fallback');
    return report;
  } catch (error) {
    report.failure = { name: error.name, message: error.message, previewText: await page.$eval(preview, node => node.textContent.slice(0, 1000)).catch(() => null) }; report.failureScreenshot = await screenshot('failure').catch(() => null); error.report = report; throw error;
  } finally {
    page.off('request', onRequest); page.off('pageerror', onError); await page.setViewport({ width: 1440, height: 1000 }).catch(() => {});
    report.transportIssues = badRequests; report.browserErrors = errors;
    report.privateReport = path.join(directory, 'report.json'); fs.writeFileSync(report.privateReport, JSON.stringify(report, null, 2), { mode: 0o600 });
    ctx.recordEvidence?.('web-artwork', report.privateReport);
  }
}
