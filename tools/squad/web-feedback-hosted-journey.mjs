/** Optional EXIT-03 extension. Requires the completed commerce→operations owned
 * graph. All writes use rendered UI; SDK calls are scoped read oracles only. */
import assert from 'node:assert/strict';
const STAGING_ORIGIN='https://scvojtvgnkmbupvyslmb.supabase.co';
export async function feedbackClick(page,label){
 await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===label&&!b.disabled),{timeout:30000},label);
 await page.evaluate(label=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label&&!b.disabled).click(),label);
}
export async function submitFeedback(page,{score,positive,negative,cutterId,search}){
 await feedbackClick(page,'Give feedback');await page.waitForSelector('[role="dialog"] select[name="score"]');
 await page.select('[role="dialog"] select[name="score"]',String(score));
 if(cutterId){
  const selector='[role="dialog"] input[aria-label="Search assigned cutting master"]';
  await page.type(selector,search);await page.$eval(selector,e=>e.parentElement.querySelector('button').click());
  await page.waitForFunction(id=>[...document.querySelector('[role="dialog"] select[name="to_id"]').options].some(o=>o.value===id),{timeout:30000},String(cutterId));
  await page.select('[role="dialog"] select[name="to_id"]',String(cutterId));
 }
 await page.type('[role="dialog"] textarea[name="positive"]',positive);await page.type('[role="dialog"] textarea[name="negative"]',negative);
}
async function save(ctx,page,kind,id,recipient,score){
 const wait=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).origin===STAGING_ORIGIN&&new URL(r.url()).pathname==='/rest/v1/rpc/v1_rating_save',{timeout:30000});
 await feedbackClick(page,'Save changes');const response=await wait,value=await response.json();assert.ok(response.ok(),'Feedback command rejected');
 assert.ok(value.id);ctx.record('rating',String(value.id)); // Journal before any subsequent assertion or rendering wait.
 assert.equal(value.entity_kind,kind);assert.equal(value.entity_id,String(id));assert.equal(value.to_id,String(recipient));assert.equal(Number(value.score),score);
 await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),{timeout:30000});
 return value;
}
async function open(ctx,role,path){const page=await ctx.pageFor(role);await page.goto(ctx.base+path,{waitUntil:'domcontentloaded'});await page.waitForSelector('.squad-app');assert.ok(!page.url().includes('/login'));return page;}
export async function runJourney(ctx){
 assert.ok(/^http:\/\/localhost:\d+$/.test(ctx.base));assert.match(ctx.fixture.label,/^SQB [a-f0-9]{12}$/);
 const clients=ctx.clients,orderId=ctx.commercial?.entities.factoryOrderId??ctx.commercial?.entities.customOrderIds?.[0];assert.ok(orderId,'Commerce and completed factory operations are prerequisites');
 const order=await clients.get(2).sdk.order(orderId);assert.equal(order.status,1,'Use the naturally completed factory order');assert.equal(order.type,1);assert.equal(order.factory_manager_id,clients.get(4).me.id);assert.equal(order.items.data.length,1);
 const itemId=order.items.data[0].id;assert.ok(itemId);const checks=[],ratingIds=[];
 for(const [role,recipient,kind,id,route,score] of [
  [1,2,'Order',orderId,`/squad/orders/${orderId}`,4],
  [2,4,'Order',orderId,`/squad/orders/${orderId}`,5],
  [4,9,'Item',itemId,`/squad/production/factory/${itemId}`,3],
 ]){
  const page=await open(ctx,role,route),positive=`${ctx.fixture.label} role ${role} feedback`,negative=`${ctx.fixture.label} role ${role} improvement`;
  await submitFeedback(page,{score,positive,negative,cutterId:role===4?clients.get(9).me.id:null,search:ctx.fixture.label});
  const result=await save(ctx,page,kind,id,clients.get(recipient).me.id,score);ratingIds.push(result.id);
  const read=await clients.get(role).sdk.ratings(kind,id),saved=read.data.find(r=>r.id===result.id);assert.ok(saved);assert.equal(saved.from_id,clients.get(role).me.id);assert.equal(saved.to_id,clients.get(recipient).me.id);assert.equal(saved.positive_comments,positive);assert.equal(saved.negative_comments,negative);assert.equal(saved.archived,false);
  await page.waitForFunction(text=>[...document.querySelectorAll('article')].some(a=>a.textContent.includes(text)),{timeout:30000},positive);
  if(recipient!==9){const received=await clients.get(recipient).sdk.ratings(kind,id);assert.ok(received.data.some(r=>r.id===result.id));}
  const customer=await clients.get(3).sdk.ratings(kind,id);assert.ok(!customer.data.some(r=>r.id===result.id),'Customer must not see private staff feedback');
  checks.push(role===1?'sc_order_feedback_resolves_actual_assigned_pc':role===2?'pc_order_feedback_resolves_actual_assigned_factory_manager':'fm_item_feedback_selects_actual_assigned_cutting_master');
 }
 const adminPage=await open(ctx,0,`/squad/orders/${orderId}`),moderatedId=ratingIds[0],reason=ctx.fixture.label+' controlled moderation';
 const before=await clients.get(0).sdk.ratings('Order',orderId);assert.ok(before.data.some(r=>r.id===moderatedId));
 // Select the exact authored record, never the first arbitrary Moderate action.
 const comment=ctx.fixture.label+' role 1 feedback';await adminPage.waitForFunction(comment=>[...document.querySelectorAll('article')].some(a=>a.textContent.includes(comment)&&[...a.querySelectorAll('button')].some(b=>b.textContent.trim()==='Moderate')),{timeout:30000},comment);
 await adminPage.evaluate(comment=>[...document.querySelectorAll('article')].find(a=>a.textContent.includes(comment)).querySelector('button').click(),comment);
 await adminPage.waitForSelector('[role="dialog"] input[name="reason"]');await adminPage.type('[role="dialog"] input[name="reason"]',reason);
 const wait=adminPage.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).origin===STAGING_ORIGIN&&new URL(r.url()).pathname==='/rest/v1/rpc/v1_rating_archive',{timeout:30000});await feedbackClick(adminPage,'Save changes');const response=await wait,archived=await response.json();assert.ok(response.ok());assert.equal(archived.id,moderatedId);assert.equal(archived.archived,true);
 await adminPage.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
 const normal=await clients.get(0).sdk.ratings('Order',orderId);assert.ok(!normal.data.some(r=>r.id===moderatedId));assert.equal(normal.summary.count,before.summary.count-1);
 const history=await clients.get(0).sdk.ratings('Order',orderId,{includeArchived:true});const retained=history.data.find(r=>r.id===moderatedId);assert.ok(retained?.archived);assert.equal(retained.moderation_reason,reason);assert.equal(retained.positive_comments,comment);
 await adminPage.evaluate(()=>[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Include moderated')).querySelector('input').click());
 await adminPage.waitForFunction(reason=>[...document.querySelectorAll('article')].some(a=>a.textContent.includes(reason)&&a.textContent.includes('Moderated')),{timeout:30000},reason);
 assert.ok(!(await clients.get(1).sdk.ratings('Order',orderId)).data.some(r=>r.id===moderatedId));
 checks.push('admin_moderation_hides_exact_rating_preserves_reason_and_history_and_recalculates_visible_count');
 return {checks,entities:{orderId,itemId,ratingIds},scope:'Actual rendered role-specific feedback on the previously completed owned factory graph; all commands journaled by parent, no providers. Exact parent cleanup remains required.'};
}
