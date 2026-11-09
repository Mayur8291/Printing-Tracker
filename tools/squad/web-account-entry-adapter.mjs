/** Browser adapter only; deliberately NOT wired into web-business-hosted.mjs.
 * Parent must supply a separately fenced, exact-owned guest-account rehearsal:
 * - page: isolated guest browser with pre-journaled request UUIDs;
 * - scenario: kind, owned email, password, profile (signup), requestId (invite);
 * - assertOwnedScenario(): verifies source/credential baseline, narrow capability,
 *   retained audits and executable cleanup before any request;
 * - recordRequest(id), recordCompletion(result): durable cleanup journal hooks;
 * - readCode({kind,email,requestId}): controlled inbox proof, never fabricated OTP;
 * - verifyCompletion(result): real Auth/SDK proof of pending approval or usable
 *   login, previous-session/password revocation and exact-owned source changes.
 * Never reuse legacy harnesses that enable cutover or rewind/delete audit history.
 */
import assert from 'node:assert/strict';

const paths = { register: 'register', confirm: 'confirm', recovery: 'recovery', invite: 'users/invite' };
async function fill(page, key, value) {
  const selector = `#account-${key}`;
  await page.waitForSelector(selector, { visible: true });
  await page.$eval(selector, (node, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
}
async function submit(page) {
  await page.waitForFunction(() => { const button = document.querySelector('button[type=submit]'); return button && !button.disabled; });
  await page.click('button[type=submit]');
}
function responseFor(page, kind, action) {
  return page.waitForResponse(response => {
    if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== `/functions/v1/squad-account/${paths[kind]}`) return false;
    try { return JSON.parse(response.request().postData()).action === action; } catch { return false; }
  }, { timeout: 40_000 });
}
export async function runAccountEntry(ctx) {
  const hooks = ctx.accountEntry;
  assert.ok(hooks, 'Account-entry rehearsal and cleanup hooks are required; current business fixture alone is insufficient');
  for (const name of ['assertOwnedScenario', 'recordRequest', 'recordCompletion', 'readCode', 'verifyCompletion']) assert.equal(typeof hooks[name], 'function', `Missing ${name}`);
  assert.match(ctx.base, /^http:\/\/localhost:\d+$/);
  const { page, scenario } = hooks, { kind, email } = scenario;
  const stage=name=>hooks.onStage?.(name);
  assert.ok(Object.hasOwn(paths, kind)); assert.ok(page && email && scenario.password?.length >= 12 && Buffer.byteLength(scenario.password, 'utf8') <= 72);
  stage('account_scope');await hooks.assertOwnedScenario();
  let code = '', requestId = scenario.requestId, completedRequests = 0;
  const onRequest = request => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== `/functions/v1/squad-account/${paths[kind]}`) return;
    try { if (JSON.parse(request.postData()).action === 'complete') completedRequests++; } catch { /* Non-JSON requests cannot satisfy the response matcher. */ }
  };
  page.on('request', onRequest);
  try {
    stage('page_navigation');await page.goto(`${ctx.base}/account/${kind}${kind === 'invite' ? `?request_id=${encodeURIComponent(requestId)}` : ''}`, { waitUntil: 'domcontentloaded' });
    stage('email_entry');
    await fill(page, 'email', email);
    if (kind === 'invite') {
      assert.match(requestId, /^[a-f0-9-]{36}$/);
      assert.equal(await page.$eval('#account-requestId', node => node.value), requestId);
    } else {
      if (kind === 'register') {
        stage('profile_entry');
        const profile = scenario.profile;
        assert.ok(profile?.addresses?.length === 1, 'Use an owned new-customer source profile with one address');
        for (const key of ['first_name', 'last_name', 'company_name', 'phone']) await fill(page, key, profile[key]);
        for (const key of ['address', 'state', 'city', 'zip_code']) await fill(page, key, profile.addresses[0][key]);
      }
      stage('request_submit');const requested = responseFor(page, kind, 'request'); await submit(page);
      stage('request_response');
      const response = await requested, receipt = await response.json();
      assert.equal(response.ok(), true); assert.equal(receipt.accepted, true);
      requestId = JSON.parse(response.request().postData()).request_id;
      stage('request_recorded');await hooks.recordRequest(requestId);
      stage('proof_form');
      await page.waitForSelector('#account-code', { visible: true });
      assert.equal(await page.$eval('#account-email', node => node.disabled), true);
    }
    stage('inbox_proof');code = await hooks.readCode({ kind, email, requestId }); assert.match(code, /^\d{8}$/);
    stage('password_mismatch');
    await fill(page, 'code', code); await fill(page, 'password', scenario.password); await fill(page, 'confirm', `${scenario.password} mismatch`);
    await submit(page); await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.includes('passwords do not match'));
    assert.equal(completedRequests, 0, 'Mismatched passwords must not send an account completion');
    await fill(page, 'confirm', scenario.password);
    const wrong = `${code[0] === '0' ? '1' : '0'}${code.slice(1)}`;
    await fill(page, 'code', wrong);
    stage('wrong_proof_submit');const refused = responseFor(page, kind, 'complete'); await submit(page);
    stage('wrong_proof_response');
    const refusal = await refused; assert.equal(refusal.ok(), false); assert.equal((await refusal.json()).error, 'INVALID_OR_EXPIRED_CODE');
    await page.waitForSelector('[role=alert]', { visible: true });
    await fill(page, 'code', code);
    stage('correct_proof_submit');const accepted = responseFor(page, kind, 'complete'); await submit(page);
    stage('correct_proof_response');
    const response = await accepted, receipt = await response.json();
    assert.equal(response.ok(), true); assert.equal(receipt.completed, true);
    stage('completion_recorded');await hooks.recordCompletion(receipt);
    stage('completion_status');
    await page.waitForFunction(next => document.querySelector('[role=status]')?.textContent.includes(next === 'await_approval' ? 'awaiting business approval' : 'Sign in with your password'), {}, receipt.next);
    stage('completion_secrets_removed');assert.equal(await page.$('#account-password'), null, 'Completed proof removes the password fields');
    stage('authority_verification');const authority = await hooks.verifyCompletion(receipt);
    assert.equal(authority.passed, true, 'The parent must supply actual Auth/source assertions, not only browser success copy');
    return { kind, requestId, userId: receipt.user_id, next: receipt.next, checks: ['owned_guest_form_request', 'password_mismatch_stays_local', 'wrong_proof_rejected_without_losing_form', 'real_inbox_code_completion', 'correct_approval_or_signin_result'], authority };
  } finally { code = ''; page.off('request', onRequest); }
}
