/** Optional actual shared-MediaField adapter. Not wired into the business runner.
 * Required ctx.mediaAcceptance: assertOwnedTarget(), target, role, route, label,
 * files:[{path,sha256,bytes},{path,sha256,bytes}], recordReservation(id,target),
 * verifyCleanupReady({target,uploadIds}). The parent must first extend its exact
 * source/Auth/Storage cleanup proof; retained audits are never deleted/rewound.
 * Run before fixture account closure. This adapter cannot grant write ownership.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const endpoint = name => `/functions/v1/squad-account/media/${name}`;
const post = (response, name) => response.request().method() === 'POST' && new URL(response.url()).pathname === endpoint(name);
async function section(page, label) {
  await page.waitForFunction(label => [...document.querySelectorAll('main section')].some(node => node.querySelector('h3')?.textContent.trim() === label), {}, label);
  return page.evaluateHandle(label => [...document.querySelectorAll('main section')].find(node => node.querySelector('h3')?.textContent.trim() === label), label);
}
async function clickIn(handle, text) {
  await handle.evaluate((node, text) => { const button = [...node.querySelectorAll('button')].find(button => button.textContent.trim() === text && !button.disabled); if (!button) throw new Error(`Enabled media action missing: ${text}`); button.click(); }, text);
}
async function download(page, handle, directory, expected) {
  const cdp = await page.browser().target().createCDPSession();
  const contextId = page.browserContext().id;
  let timer, started;
  const completed = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Browser file download did not complete')), 30_000);
    cdp.on('Browser.downloadWillBegin', event => { started = event.guid; });
    cdp.on('Browser.downloadProgress', event => { if (event.guid !== started) return; if (event.state === 'completed') resolve(event.guid); else if (event.state === 'canceled') reject(new Error('Browser download canceled')); });
  });
  completed.catch(() => {});
  try {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: directory, eventsEnabled: true, ...(contextId ? { browserContextId: contextId } : {}) });
    const grantResponse = page.waitForResponse(response => post(response, 'grants') && JSON.parse(response.request().postData()).download === true);
    await clickIn(handle, 'Download');
    const response = await grantResponse; assert.equal(response.ok(), true);
    const grant = (await response.json()).references[0]; assert.equal(grant.status, 'ready');
    assert.equal(new URL(grant.url).origin, 'https://scvojtvgnkmbupvyslmb.supabase.co');
    const guid = await completed, filename = path.join(directory, guid);
    assert.match(guid, /^[a-zA-Z0-9-]+$/); fs.chmodSync(filename, 0o600);
    const bytes = fs.readFileSync(filename); assert.equal(hash(bytes), expected.sha256); assert.equal(bytes.length, expected.bytes);
    fs.unlinkSync(filename);
    return { downloaded: true, bytes: bytes.length, sha256: expected.sha256 };
  } finally {
    clearTimeout(timer); completed.catch(() => {});
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', ...(contextId ? { browserContextId: contextId } : {}) }).catch(() => {}); await cdp.detach();
  }
}

export async function runMediaField(ctx) {
  const hooks = ctx.mediaAcceptance;
  assert.ok(hooks, 'Media source/Storage cleanup extension is required before real upload tests');
  for (const key of ['assertOwnedTarget', 'recordReservation', 'verifyCleanupReady']) assert.equal(typeof hooks[key], 'function');
  assert.match(ctx.base, /^http:\/\/localhost:\d+$/);
  assert.equal(hooks.role, 3, 'This journey is restricted to the owned Customer profile');
  assert.equal(hooks.route, '/squad/profile');
  assert.equal(hooks.label, 'Profile photo');
  assert.deepEqual(hooks.target, { resource: 'users', record_id: String(ctx.fixture.actors['3']), field: 'profile_image' });
  assert.equal(hooks.files?.length, 2, 'Use two known safe files to verify replacement');
  const files = hooks.files.map(file => {
    assert.equal(typeof file.path, 'string'); assert.match(file.sha256, /^[a-f0-9]{64}$/);
    const bytes = fs.readFileSync(file.path);
    assert.ok(bytes.length > 0 && bytes.length <= 10 * 1024 * 1024);
    assert.equal(bytes.length, file.bytes); assert.equal(hash(bytes), file.sha256);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Use actual PNG fixture bytes');
    return { ...file, path: path.resolve(file.path) };
  });
  assert.notEqual(files[0].sha256, files[1].sha256, 'Replacement must have distinct manifest bytes');
  await hooks.assertOwnedTarget();
  const target = hooks.target, entry = (ctx.clientsMap ?? ctx.clients).get(hooks.role), page = await ctx.pageFor(hooks.role);
  assert.equal(entry.me.id, String(ctx.fixture.actors[String(hooks.role)]));
  const original = (await entry.sdk.mediaGrants([target])).references[0];
  assert.equal(original.status, 'empty', 'Only an exact-owned initially empty field is accepted by this adapter');
  const directory = path.resolve('tools/squad/private', `web-media-download-${String(ctx.runId).replace(/[^a-zA-Z0-9_-]/g, '_')}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
  const uploads = [], checks = [], downloads = []; let handle;
  try {
    await page.goto(ctx.base + hooks.route, { waitUntil: 'domcontentloaded' });
    for (const [index, file] of files.entries()) {
      const expected = { sha256: file.sha256, bytes: file.bytes };
      assert.equal(hash(fs.readFileSync(file.path)), file.sha256, 'Manifest file changed before upload');
      handle = await section(page, hooks.label);
      const input = await handle.asElement().$('input[type=file]'); assert.ok(input); await input.uploadFile(file.path); await input.dispose();
      await page.waitForFunction(label => { const node = [...document.querySelectorAll('main section')].find(node => node.querySelector('h3')?.textContent.trim() === label); return [...node.querySelectorAll('button')].some(button => button.textContent.trim() === 'Upload and save' && !button.disabled); }, {}, hooks.label);
      const reserved = page.waitForResponse(response => post(response, 'uploads'), { timeout: 30_000 });
      const verified = page.waitForResponse(response => post(response, 'verify'), { timeout: 45_000 });
      const finalized = page.waitForResponse(response => post(response, 'finalize'), { timeout: 45_000 });
      // Each waiter is observed even when an earlier stage fails.
      verified.catch(() => {}); finalized.catch(() => {});
      await clickIn(handle, 'Upload and save');
      const reserveResponse = await reserved, reservation = await reserveResponse.json(); assert.equal(reserveResponse.ok(), true);
      assert.match(reservation.upload_id, /^[a-f0-9-]{36}$/);
      uploads.push(reservation.upload_id); await hooks.recordReservation(reservation.upload_id, target);
      assert.equal((await verified).ok(), true); assert.equal((await finalized).ok(), true);
      await handle.dispose(); handle = null;
      await page.waitForNetworkIdle({ idleTime: 250, timeout: 5000 }).catch(() => {});
      handle = await section(page, hooks.label);
      const grant = (await entry.sdk.mediaGrants([target])).references[0]; assert.equal(grant.status, 'ready'); assert.notEqual(grant.version, original.version);
      if (grant.content_type.startsWith('image/') && grant.content_type !== 'image/svg+xml') {
        await page.waitForFunction((label, pathname) => { const node=[...document.querySelectorAll('main section')].find(node=>node.querySelector('h3')?.textContent.trim()===label), image=node?.querySelector('img'); return image?.complete && image.naturalWidth>0 && new URL(image.src).pathname===pathname; }, {}, hooks.label, new URL(grant.url).pathname);
        await handle.evaluate(async node => { const image = node.querySelector('img'); if (!image) throw new Error('Attached image preview missing'); await image.decode(); if (!image.naturalWidth) throw new Error('Attached image did not decode'); });
      }
      downloads.push(await download(page, handle, directory, expected));
      checks.push(index === 0 ? 'real_browser_upload_verify_attach_preview_download' : 'real_browser_replace_download_matches_replacement_bytes');
      await handle.dispose(); handle = null;
    }
    handle = await section(page, hooks.label); await clickIn(handle, 'Remove');
    await page.waitForSelector('[role=dialog] textarea'); await page.type('[role=dialog] textarea', `${ctx.fixture.label} media acceptance complete`);
    const detached = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/rest/v1/rpc/v1_media_detach');
    await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find(button => button.textContent.trim() === 'Remove attachment' && !button.disabled).click());
    assert.equal((await detached).ok(), true); await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    assert.equal((await entry.sdk.mediaGrants([target])).references[0].status, 'empty');
    checks.push('real_browser_detach_restores_empty_owned_field');
    const cleanupProof = await hooks.verifyCleanupReady({ target, uploadIds: uploads }); assert.equal(cleanupProof.passed, true);
    return { checks, uploadIds: uploads, downloads, cleanupProof, scope: 'Owned shared MediaField upload/replacement/detach and actual Chrome byte-verified download; audits retained; parent performs proven object/source cleanup' };
  } finally { if (handle) await handle.dispose(); }
}

// Shared exact-byte browser download used by the separately reviewed catalogue rehearsal.
export { download as downloadOwnedMedia };
