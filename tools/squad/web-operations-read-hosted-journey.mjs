/** Read-only extension to collaboration: inspect exact-owned queued work, never claim, drain or retry it. */
import assert from 'node:assert/strict';
import {field} from './web-people-hosted-journey.mjs';
const ORIGIN='https://scvojtvgnkmbupvyslmb.supabase.co';
async function click(page,label){await page.waitForFunction(label=>[...document.querySelectorAll('main button')].some(b=>b.textContent.trim()===label&&!b.disabled),{},label);await page.evaluate(label=>[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()===label&&!b.disabled).click(),label);}
async function settledJobRows(page,result){await page.waitForFunction(expected=>{const rows=[...document.querySelectorAll('tbody tr')].filter(r=>r.children.length===7);return rows.length===expected.length&&rows.every((r,i)=>r.children[0].textContent===expected[i].event&&r.children[1].textContent===expected[i].kind&&r.children[2].textContent===expected[i].entity_id);},{},result.data);}
export async function response(page,name,action,predicate=()=>true){const waiting=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).origin===ORIGIN&&new URL(r.url()).pathname===`/rest/v1/rpc/${name}`&&predicate(JSON.parse(r.request().postData()||'{}')));waiting.catch(()=>{});await action();const r=await waiting;assert.ok(r.ok(),`${name}: HTTP ${r.status()}`);return r.json();}
export async function runJourney(ctx){
 assert.match(ctx.base,/^http:\/\/localhost:\d+$/);assert.match(ctx.fixture.label,/^SQB [a-f0-9]{12}$/);
 const id=String(ctx.journeys.collaboration?.entities.taskId||'');assert.match(id,/^[1-9]\d*$/,'Run collaboration first; only its journaled task is accepted');
 const admin=ctx.clients.get(0).sdk,team=ctx.clients.get(12).sdk,foreign=ctx.clients.get(1).sdk,checks=[];
 for(const role of[0,1,12])assert.equal(ctx.clients.get(role).me.id,String(ctx.fixture.actors[String(role)]));
 // This is the Team actor's own queue, never an unbounded administrative export.
 let cursor=null,job;for(let page=0;page<4&&!job;page++){const result=await team.jobs('pending',{cursor,limit:25});assert.ok(result.data.length<=25);job=result.data.find(j=>j.kind==='task'&&j.entity_id===id);if(!result.next_cursor)break;cursor=result.next_cursor;}
 assert.ok(job,'No exact-owned pending task event found within the bounded queue');
 const original=await team.job(job.id);assert.equal(original.kind,'task');assert.equal(original.entity_id,id);assert.equal(original.state,'pending');assert.equal((await admin.job(job.id)).version,original.version);
 await assert.rejects(foreign.job(job.id),e=>['not_found','forbidden'].includes(e.kind));await assert.rejects(foreign.audit({kind:'task',entityId:id},{limit:1}),e=>e.kind==='forbidden');
 const audit=await admin.audit({kind:'task',entityId:id},{limit:1});assert.equal(audit.data.length,1);assert.ok(audit.next_cursor,'Collaboration creates multiple audit rows');const second=await admin.audit({kind:'task',entityId:id},{cursor:audit.next_cursor,limit:1});assert.equal(second.data.length,1);assert.notEqual(audit.data[0].id,second.data[0].id);await assert.rejects(admin.audit({kind:'order',entityId:id},{cursor:audit.next_cursor,limit:1}),e=>['validation','conflict'].includes(e.kind));
 checks.push('team_own_job_and_admin_read_allowed_foreign_job_and_nonadmin_audit_denied','exact_task_audit_cursor_paginates_without_duplicates_and_rejects_filter_swap');
 const page=await ctx.pageFor(0);await page.goto(ctx.base+'/squad/administration/audit',{waitUntil:'domcontentloaded'});await field(page,'Record type','task');await field(page,'Record ID',id);
 const shown=await response(page,'v1_audit_list',()=>click(page,'Apply filters'),p=>p.p_kind==='task'&&p.p_entity_id===id);assert.ok(shown.data.length>0);assert.ok(shown.data.every(r=>r.kind==='task'&&r.entity_id===id));await page.waitForFunction(id=>{const rows=[...document.querySelectorAll('tbody tr')].filter(r=>r.querySelectorAll('td').length===5);return rows.length>0&&rows.every(r=>r.children[1].textContent==='task'&&r.children[2].textContent===id);},{},id);
 checks.push('admin_rendered_audit_filters_show_only_journaled_task_history');
 await page.goto(ctx.base+'/squad/administration/jobs',{waitUntil:'domcontentloaded'});await settledJobRows(page,await response(page,'v1_jobs_list',()=>field(page,'Job status','pending'),p=>p.p_state==='pending'));
 let found=false;for(let i=0;i<8;i++){found=await page.evaluate(id=>[...document.querySelectorAll('tbody tr')].some(r=>r.children[1]?.textContent==='task'&&r.children[2]?.textContent===id),id);if(found)break;const next=await page.evaluate(()=>[...document.querySelectorAll('main button')].some(b=>b.textContent.trim()==='Next'&&!b.disabled));if(!next)break;await settledJobRows(page,await response(page,'v1_jobs_list',()=>click(page,'Next'),p=>p.p_state==='pending'&&!!p.p_cursor));}
 assert.ok(found,'Exact owned job not found in eight bounded UI pages');
 const selected=await response(page,'v1_job_get',()=>page.evaluate(id=>[...document.querySelectorAll('tbody tr')].find(r=>r.children[1]?.textContent==='task'&&r.children[2]?.textContent===id).querySelector('button').click(),id));
 assert.equal(selected.kind,'task');assert.equal(selected.entity_id,id);assert.equal(selected.state,'pending');await page.waitForFunction(id=>[...document.querySelectorAll('section')].some(s=>s.querySelector('h2')?.textContent==='Job details'&&s.textContent.includes('task #'+id)),{},id);
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('main button')].some(b=>b.textContent.trim()==='Retry failed job')),false);await click(page,'Close');await page.goto(ctx.base+'/squad/notifications',{waitUntil:'domcontentloaded'});
 checks.push('admin_rendered_queued_job_detail_is_bounded_and_has_no_retry_action');
 // With workers paused, the fixture has no materialized notifications. Do not fabricate a delivery proof.
 for(const role of[3,12]){const sdk=ctx.clients.get(role).sdk;assert.deepEqual((await sdk.notifications(null,{limit:1})).data,[]);const inbox=await ctx.pageFor(role);await inbox.goto(ctx.base+'/squad/notifications',{waitUntil:'domcontentloaded'});await inbox.waitForFunction(()=>document.querySelector('main')?.textContent.includes('You’re all caught up'));}
 const deniedPage=await ctx.pageFor(1);await deniedPage.goto(ctx.base+'/squad/administration/jobs',{waitUntil:'domcontentloaded'});await deniedPage.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Your role does not have access to this workspace.'));
 checks.push('sc_administration_jobs_deep_link_remains_denied');
 assert.equal((await team.job(job.id)).version,original.version,'Read-only inspection must not requeue or mutate the job');
 checks.push('customer_and_team_render_empty_recipient_scoped_inboxes_with_workers_paused');
 return{checks,entities:{taskId:id,jobId:job.id},scope:'Read-only actual UI/SDK inspection of one earlier journaled Team task. No retry, claim, worker, fanout, delivery, device registration or acknowledgement mutation. Notification destination and error/pagination controls have separate local component coverage.'};
}
