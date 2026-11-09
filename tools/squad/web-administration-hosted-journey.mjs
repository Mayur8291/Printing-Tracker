/** Owned settings only. Never change live release policies, integration toggles or jobs. */
import assert from 'node:assert/strict';
async function click(page,label){await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===label&&!b.disabled),{},label);await page.evaluate(label=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label&&!b.disabled).click(),label);}
async function field(page,label,value){
 await page.waitForFunction(label=>[...document.querySelectorAll('label')].some(l=>l.textContent.trim().replace(/\s*\*$/,'')===label),{},label);
 const h=await page.evaluateHandle(label=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().replace(/\s*\*$/,'')===label);return document.getElementById(l.htmlFor);},label);
 const e=h.asElement();assert.ok(e);
 if(await e.evaluate(e=>e.tagName==='SELECT')){await page.waitForFunction((label,value)=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().replace(/\s*\*$/,'')===label);return [...document.getElementById(l.htmlFor).options].some(o=>o.value===value);},{},label,String(value));await e.select(String(value));}
 else{await e.click({clickCount:3});await e.press('Backspace');await e.type(String(value));}await h.dispose();
}
async function save(page,label,onAccepted=()=>{}){const pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/rpc/v1_settings_save'));await click(page,label);const r=await pending,v=await r.json();assert.ok(r.ok(),`Settings ${v.code||r.status()} ${v.message||''}`);onAccepted(v);await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));return v;}
export async function runJourney(ctx){
 const page=await ctx.pageFor(0),sdk=ctx.clients.get(0).sdk,checks=[];let ownedZone;
 await page.goto(ctx.base+'/squad/administration',{waitUntil:'networkidle0'});
 for(const [group,tab,singular]of [['zones','Zones','zone'],['cities','Cities','city'],['criteria','Inspection criteria','inspection criterion']]){
  await click(page,tab);await click(page,group==='criteria'?'Add criterion':`Add ${singular}`);
  const original=ctx.fixture.label+' browser '+group;
  await field(page,'Name',original);if(group==='cities')await field(page,'Zone',ownedZone.id);
  await field(page,'Reason for change',ctx.fixture.label+' create owned setting');
  const created=await save(page,`Create ${singular}`,result=>ctx.record('setting_'+group,result.id));
  assert.ok((await sdk.settings(group,{limit:30})).data.some(r=>r.id===created.id&&r.name===original));
  await page.waitForSelector(`button[aria-label="Edit ${original}"]`);await page.click(`button[aria-label="Edit ${original}"]`);
  const updated=original+' revised';await field(page,'Name',updated);await field(page,'Reason for change',ctx.fixture.label+' edit owned setting');
  const edited=await save(page,'Save changes');assert.equal(edited.id,created.id);assert.notEqual(edited.version,created.version);
  if(group==='zones'){ownedZone={id:created.id,name:updated};continue;}
  await page.waitForSelector(`button[aria-label="Archive ${updated}"]`);await page.click(`button[aria-label="Archive ${updated}"]`);
  await field(page,'Reason for change',ctx.fixture.label+' archive owned setting');await save(page,'Archive record');
  const row=(await sdk.settings(group,{limit:30})).data.find(r=>r.id===created.id);
  if(group==='zones')assert.equal(row.archived,true);else assert.equal(row,undefined);
  checks.push(`admin_real_browser_${group}_create_edit_archive_with_reason_and_version`);
 }
 await click(page,'Zones');await page.waitForSelector(`button[aria-label="Archive ${ownedZone.name}"]`);await page.click(`button[aria-label="Archive ${ownedZone.name}"]`);
 await field(page,'Reason for change',ctx.fixture.label+' archive owned zone');await save(page,'Archive record');
 assert.equal((await sdk.settings('zones',{limit:30})).data.find(r=>r.id===ownedZone.id).archived,true);
 checks.push('admin_real_browser_zones_create_edit_archive_after_city_dependency_removed');
 return {checks,scope:'Only three new exact-owned settings; no global release policy, provider configuration, job execution or ownership changes'};
}
