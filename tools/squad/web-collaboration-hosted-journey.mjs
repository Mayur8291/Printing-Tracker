/** Actual UI commands on the parent harness's disposable staging identities.
 * The parent owns sessions, write fencing, side-effect suppression and cleanup.
 * SDK calls here are read oracles only; every mutation goes through the browser.
 */
import assert from 'node:assert/strict';

const timeout = 30_000;
const plusDays = (day, count) => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);

async function click(page, label, { scope = 'main', aria = false } = {}) {
  const predicate = (scope, label, aria) => [...document.querySelectorAll(`${scope} button`)]
    .find(button => button.getClientRects().length && !button.disabled && (aria ? button.getAttribute('aria-label') : button.textContent.trim()) === label);
  await page.waitForFunction(predicate, { timeout }, scope, label, aria);
  const handle = await page.evaluateHandle(predicate, scope, label, aria);
  try { await handle.asElement().click(); } finally { await handle.dispose(); }
}

async function field(page, label, value, scope = '[role="dialog"]') {
  const find = (scope, label) => [...document.querySelectorAll(`${scope} label`)]
    .find(node => node.textContent.trim().replace(/\s*\*$/, '') === label)?.htmlFor;
  await page.waitForFunction(find, { timeout }, scope, label);
  const id = await page.evaluate(find, scope, label);
  const handle = await page.evaluateHandle(id => document.getElementById(id), id);
  try {
    if (await handle.evaluate(node => node.tagName === 'SELECT')) {
      await page.waitForFunction((id, value) => [...document.getElementById(id).options].some(option => option.value === value), { timeout }, id, String(value));
      await handle.asElement().select(String(value));
    } else {
      // Native date controls do not accept keyboard text consistently in Chrome.
      // Use the native setter and bubbled events so React runs the real handler.
      await handle.evaluate((node, value) => {
        const prototype = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, String(value));
    }
  } finally { await handle.dispose(); }
}

async function person(page, label, id, search, scope = '[role="dialog"]') {
  const selector = `${scope} input[aria-label="Search ${label.toLowerCase()}"]`;
  await page.waitForSelector(selector);
  await page.type(selector, search);
  await click(page, 'Find', { scope });
  const select = `${scope} select[aria-label="${label}"]`;
  await page.waitForFunction((selector, id) => [...(document.querySelector(selector)?.options || [])].some(option => option.value === id), { timeout }, select, id);
  await page.select(select, id);
}

async function goto(ctx, page, path, expectedText) {
  await page.goto(ctx.base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(text => document.querySelector('.squad-app main')?.textContent.includes(text) && !document.querySelector('main [aria-busy="true"]'), { timeout }, expectedText);
  assert.ok(!page.url().includes('/login'), 'Expected a harness-authenticated persona');
}

export async function rpc(page, name, action, onAccepted = () => {}, dialog = true) {
  const waiting = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/rest/v1/rpc/${name}`, { timeout });
  waiting.catch(() => {});
  await action();
  const response = await waiting;
  const result = await response.json();
  assert.equal(response.ok(), true, `${name}: ${result.code || response.status()} ${result.message || ''}`);
  // Journal before waiting for UI success, so a rendering failure cannot orphan a row.
  onAccepted(result);
  if (dialog) await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout });
  return result;
}

function own(ctx, kind, id) {
  assert.match(String(id), /^[1-9][0-9]*$/, `Missing ${kind} identity`);
  ctx.record(kind, String(id));
  return String(id);
}

async function taskTransition(page, action, submit) {
  await click(page, action, { aria: action === 'Archive' });
  return rpc(page, 'v1_task_transition', () => click(page, submit, { scope: '[role="dialog"]' }));
}

async function targetRowAction(page, name, action) {
  const find = (name, action) => [...document.querySelectorAll('main tbody tr')]
    .find(row => [...row.querySelectorAll('button')].some(button => button.textContent.trim() === name))
    ?.querySelector(`button[aria-label="${action}"]`);
  await page.waitForFunction(find, { timeout }, name, action);
  const handle = await page.evaluateHandle(find, name, action);
  try { await handle.asElement().click(); } finally { await handle.dispose(); }
}

export async function runJourney(ctx) {
  assert.match(ctx.base, /^http:\/\/localhost:\d+$/, 'Expected the parent-owned local frontend');
  const f = ctx.fixture;
  assert.match(f.label, /^SQB [a-f0-9]{12}$/);
  assert.equal(typeof ctx.record, 'function', 'Exact cleanup journal is required');
  const clients = ctx.clientsMap ?? ctx.clients;
  const admin = clients.get(0), team = clients.get(12), sc = clients.get(1);
  for (const [role, client] of [[0, admin], [12, team], [1, sc]]) {
    assert.equal(String(client.me.id), String(f.actors[String(role)]), `Role ${role} must be the exact fixture identity`);
  }
  const liveTeam = await team.sdk.me();
  assert.equal(liveTeam.capabilities.notes, true, 'Harness must grant Team notes before this journey');
  assert.equal(liveTeam.capabilities.goals, true, 'Harness must grant Team goals before this journey');
  const teamPage = await ctx.pageFor(12), adminPage = await ctx.pageFor(0), scPage = await ctx.pageFor(1);
  const checks = [], entities = {};
  const note = `${f.label} browser personal task`, revisedNote = `${note} revised`;

  await goto(ctx, teamPage, '/squad/tasks', 'Tasks & notes');
  await click(teamPage, 'New task');
  await field(teamPage, 'Task or note', note);
  const deadlineInstant = f.dueAt || new Date(Date.now() + 86400000).toISOString();
  const localDeadline = await teamPage.evaluate(value => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }, deadlineInstant);
  await field(teamPage, 'Deadline', localDeadline);
  await rpc(teamPage, 'v1_task_save', () => click(teamPage, 'Create task', { scope: '[role="dialog"]' }), result => { entities.taskId = own(ctx, 'task', result.id); });
  let task = await team.sdk.task(entities.taskId);
  assert.equal(Math.floor(Date.parse(task.deadline) / 60000), Math.floor(Date.parse(deadlineInstant) / 60000), 'Task deadline retains the intended instant across the local datetime input');
  assert.equal(task.creator_id, team.me.id); assert.equal(task.note, note); assert.equal(task.state, 0); assert.deepEqual(task.assignee_ids, []);
  await goto(ctx, teamPage, `/squad/tasks/${entities.taskId}`, note);
  await click(teamPage, 'Edit', { aria: true }); await field(teamPage, 'Task or note', revisedNote);
  await rpc(teamPage, 'v1_task_save', () => click(teamPage, 'Save changes', { scope: '[role="dialog"]' }));
  const editedTask = await team.sdk.task(entities.taskId);
  assert.equal(editedTask.note, revisedNote); assert.equal(Date.parse(editedTask.deadline), Date.parse(task.deadline), 'Editing text must not shift the deadline');
  await taskTransition(teamPage, 'Complete', 'Mark completed');
  assert.equal((await team.sdk.task(entities.taskId)).state, 1);
  await taskTransition(teamPage, 'Reopen', 'Reopen item');
  assert.equal((await team.sdk.task(entities.taskId)).state, 0);
  await taskTransition(teamPage, 'Archive', 'Archive item');
  await teamPage.waitForFunction(() => location.pathname === '/squad/tasks' && !document.querySelector('main [role="alert"]'), { timeout });
  await assert.rejects(team.sdk.task(entities.taskId), error => error.kind === 'not_found');
  assert.ok((await team.sdk.tasks({ state: 2 }, { limit: 25 })).data.some(row => row.id === entities.taskId && row.state === 2));
  checks.push('team_real_browser_personal_task_create_edit_complete_reopen_archive');

  const responsibilityNote = `${f.label} browser Team responsibility`;
  await goto(ctx, adminPage, '/squad/goals', 'Goals & responsibilities');
  await click(adminPage, 'Assign responsibility');
  await field(adminPage, 'Responsibility', responsibilityNote); await field(adminPage, 'Type', '1'); await field(adminPage, 'Team role', '12');
  await person(adminPage, 'Team member', String(team.me.id), f.label);
  await rpc(adminPage, 'v1_responsibility_save', () => click(adminPage, 'Assign responsibility', { scope: '[role="dialog"]' }), result => {
    assert.equal(result.items?.length, 1); entities.responsibilityId = own(ctx, 'responsibility', result.items[0].id);
  });
  const assigned = await team.sdk.responsibility(entities.responsibilityId);
  assert.equal(assigned.subject_id, team.me.id); assert.equal(assigned.note, responsibilityNote); assert.equal(assigned.kind, 1); assert.equal(assigned.completed, false);
  await goto(ctx, teamPage, `/squad/goals/${entities.responsibilityId}`, responsibilityNote);
  await click(teamPage, 'Complete'); await field(teamPage, 'Reason', `${f.label} completed by assigned Team member`);
  await rpc(teamPage, 'v1_responsibility_transition', () => click(teamPage, 'Mark completed', { scope: '[role="dialog"]' }));
  assert.equal((await team.sdk.responsibility(entities.responsibilityId)).completed, true);
  await click(teamPage, 'Reopen'); await field(teamPage, 'Reason', `${f.label} reopened for follow-up`);
  await rpc(teamPage, 'v1_responsibility_transition', () => click(teamPage, 'Reopen item', { scope: '[role="dialog"]' }));
  assert.equal((await admin.sdk.responsibility(entities.responsibilityId)).completed, false);
  checks.push('admin_real_browser_assigns_exact_team_goal_subject_completes_and_reopens');

  await goto(ctx, adminPage, '/squad/goals', 'Goals & responsibilities');
  await click(adminPage, 'Assign responsibility');
  const batchNotes = [`${f.label} batch responsibility one`, `${f.label} batch responsibility two`];
  await field(adminPage, 'Responsibility', batchNotes[0]); await field(adminPage, 'Type', '0'); await field(adminPage, 'Team role', '12');
  await person(adminPage, 'Team member', String(team.me.id), f.label);
  await click(adminPage, 'Add another responsibility', { scope: '[role="dialog"]' });
  await field(adminPage, 'Responsibility 2 text', batchNotes[1]); await field(adminPage, 'Responsibility 2 type', '2');
  await rpc(adminPage, 'v1_responsibility_save', () => click(adminPage, 'Assign responsibility', { scope: '[role="dialog"]' }), result => {
    assert.equal(result.items?.length, 2); entities.batchResponsibilityIds = result.items.map(item => own(ctx, 'responsibility', item.id));
  });
  for (const [index, id] of entities.batchResponsibilityIds.entries()) {
    const row = await team.sdk.responsibility(id);
    assert.equal(row.subject_id, team.me.id); assert.equal(row.note, batchNotes[index]); assert.equal(row.kind, index === 0 ? 0 : 2);
  }
  checks.push('admin_real_browser_two_responsibilities_atomic_same_subject_distinct_types');

  // The same fixture SC may already have a target from another acceptance lane.
  // Choose a non-overlapping period by reading only this fixture's targets.
  let cursor = null, lastDay = f.periodStart || new Date().toISOString().slice(0, 10);
  for (let pages = 0; ; pages++) {
    assert.ok(pages < 20, 'Unexpected fixture milestone volume');
    const result = await admin.sdk.milestones(sc.me.id, { cursor, limit: 100 });
    for (const target of result.data) if (target.end.slice(0, 10) > lastDay) lastDay = target.end.slice(0, 10);
    cursor = result.next_cursor; if (!cursor) break;
  }
  const start = plusDays(lastDay, 1), end = plusDays(start, 6);
  const targetName = `${f.label} browser sales target`, revisedTarget = `${targetName} revised`;
  await goto(ctx, adminPage, '/squad/targets', 'Sales targets');
  await person(adminPage, 'Sales coordinator', String(sc.me.id), f.label, 'main');
  await click(adminPage, 'New target');
  await field(adminPage, 'Target name', targetName); await field(adminPage, 'Start date', start); await field(adminPage, 'End date', end); await field(adminPage, 'Target amount (₹)', '12345.67');
  await rpc(adminPage, 'v1_milestone_save', () => click(adminPage, 'Create target', { scope: '[role="dialog"]' }), result => { entities.milestoneId = own(ctx, 'milestone', result.id); });
  let target = (await sc.sdk.milestones(sc.me.id, { limit: 100 })).data.find(row => row.id === entities.milestoneId);
  assert.ok(target); assert.equal(target.subject_id, sc.me.id); assert.equal(target.start.slice(0, 10), start); assert.equal(target.end.slice(0, 10), end); assert.equal(Number(target.target_amount), 12345.67);
  await targetRowAction(adminPage, targetName, 'Edit target');
  await field(adminPage, 'Target name', revisedTarget); await field(adminPage, 'Target amount (₹)', '23456.78');
  await rpc(adminPage, 'v1_milestone_save', () => click(adminPage, 'Save changes', { scope: '[role="dialog"]' }));
  target = (await sc.sdk.milestones(sc.me.id, { limit: 100 })).data.find(row => row.id === entities.milestoneId);
  assert.equal(target.name, revisedTarget); assert.equal(Number(target.target_amount), 23456.78);
  const uiProgress = await rpc(adminPage, 'v1_milestone_progress', () => click(adminPage, revisedTarget), () => {}, false);
  const oracle = await sc.sdk.milestoneProgress(entities.milestoneId);
  for (const key of ['id', 'subject_id', 'target_amount', 'placed_amount', 'completed_amount', 'order_count', 'period_start_utc', 'period_end_exclusive_utc']) assert.equal(uiProgress[key], oracle[key], `Target progress ${key}`);
  await adminPage.waitForFunction(() => document.querySelector('main')?.textContent.includes('Target progress'));
  await goto(ctx, scPage, `/squad/targets/${entities.milestoneId}`, 'Target progress');
  assert.equal(await scPage.evaluate(() => [...document.querySelectorAll('main button')].some(button => ['New target', 'Edit target', 'Archive target'].includes(button.getAttribute('aria-label') || button.textContent.trim()))), false);
  await targetRowAction(adminPage, revisedTarget, 'Archive target'); await field(adminPage, 'Reason', `${f.label} browser target lifecycle complete`);
  await rpc(adminPage, 'v1_milestone_archive', () => click(adminPage, 'Archive target', { scope: '[role="dialog"]' }));
  assert.ok(!(await sc.sdk.milestones(sc.me.id, { limit: 100 })).data.some(row => row.id === entities.milestoneId));
  await assert.rejects(sc.sdk.milestoneProgress(entities.milestoneId), error => error.kind === 'not_found');
  checks.push('admin_real_browser_target_create_edit_progress_archive_sc_read_only_projection');

  const batchStart = plusDays(end, 1), firstEnd = plusDays(batchStart, 6), secondStart = plusDays(firstEnd, 1), secondEnd = plusDays(secondStart, 6);
  const batchNames = [`${f.label} batch target one`, `${f.label} batch target two`];
  await click(adminPage, 'New target');
  await field(adminPage, 'Target name', batchNames[0]); await field(adminPage, 'Start date', batchStart); await field(adminPage, 'End date', firstEnd); await field(adminPage, 'Target amount (₹)', '500.25');
  await click(adminPage, 'Add another target', { scope: '[role="dialog"]' });
  await field(adminPage, 'Target name 2', batchNames[1]); await field(adminPage, 'End date 2', secondEnd); await field(adminPage, 'Target amount (₹) 2', '600.75');
  await rpc(adminPage, 'v1_milestones_create', () => click(adminPage, 'Create target', { scope: '[role="dialog"]' }), result => {
    assert.equal(result.created, 2); entities.batchMilestoneIds = result.data.map(row => own(ctx, 'milestone', row.id));
  });
  const pending = await rpc(adminPage, 'v1_milestones_list', () => field(adminPage, 'Target progress filter', 'pending', 'main'), () => {}, false);
  for (const [index, id] of entities.batchMilestoneIds.entries()) {
    const row = pending.data.find(item => item.id === id);
    assert.ok(row, 'Future batch target must be visible in pending filter'); assert.equal(row.name, batchNames[index]);
    assert.equal(row.start.slice(0,10), index === 0 ? batchStart : secondStart);
    assert.equal(row.end.slice(0,10), index === 0 ? firstEnd : secondEnd);
    assert.equal(Number(row.target_amount), index === 0 ? 500.25 : 600.75);
    assert.equal((await sc.sdk.milestoneProgress(id)).subject_id, sc.me.id);
  }
  const achieved = await rpc(adminPage, 'v1_milestones_list', () => field(adminPage, 'Target progress filter', 'achieved', 'main'), () => {}, false);
  assert.ok(!achieved.data.some(row => entities.batchMilestoneIds.includes(row.id)));
  checks.push('admin_real_browser_two_targets_atomic_next_day_default_pending_achieved_server_filters');
  return { checks, entities, scope: 'Exact-owned staging fixture UI lifecycle commands with authenticated SDK read oracles; no provider, email, closure or production actions.' };
}
