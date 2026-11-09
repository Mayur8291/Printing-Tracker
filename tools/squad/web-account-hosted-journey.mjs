/** Password proof and closure target only the harness-owned Customer identity. */
import assert from 'node:assert/strict';
async function click(page,text){
 await page.waitForFunction(text=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===text&&!b.disabled),{},text);
 await page.evaluate(text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text&&!b.disabled).click(),text);
}
async function fill(page,label,value){
 await page.waitForFunction(label=>[...document.querySelectorAll('label')].some(l=>l.textContent.trim().replace(/\s*\*$/,'')===label&&document.getElementById(l.htmlFor)),{},label);
 const selector=await page.evaluate(label=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().replace(/\s*\*$/,'')===label);return l?.htmlFor;},label);
 assert.ok(selector,`Missing labelled field ${label}`);
 const h=await page.evaluateHandle(id=>document.getElementById(id),selector);
 await h.asElement().click({clickCount:3});await h.asElement().press('Backspace');await h.asElement().type(value);await h.dispose();
}
export async function runJourney(ctx){
 const page=await ctx.pageFor(3),entry=ctx.clients.get(3),checks=[];
 await page.goto(ctx.base+'/squad/profile',{waitUntil:'networkidle0'});
 await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='My account');
 const name=ctx.fixture.label+' browser profile';await fill(page,'Display name',name);
 const saved=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/rpc/v1_profile_save'));
 await click(page,'Save profile');const response=await saved;assert.equal(response.ok(),true);
 await page.waitForFunction(name=>document.querySelector('.squad-app')?.textContent.includes(name),{},name);
 assert.equal((await entry.sdk.me()).name,name);checks.push('real_browser_profile_save_and_identity_refresh');
 await click(page,'Close my account');
 const credentials=ctx.customerCredentials();
 await fill(page,'Current password',credentials.password);await fill(page,'Type DELETE MY ACCOUNT to confirm','DELETE MY ACCOUNT');
 const closed=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/rpc/v1_account_close'));
 await click(page,'Permanently close account');
 const result=await closed;assert.equal(result.ok(),true);const receipt=await result.json();
 assert.equal(receipt.state,'closed');assert.equal(receipt.sessions_revoked,true);
 await page.waitForSelector('#login-email',{timeout:25000});
 await assert.rejects(entry.sdk.me(),error=>['session','forbidden','not_found'].includes(error.kind));
 const attempted=await entry.client.auth.signInWithPassword(credentials);credentials.password='';
 assert.ok(attempted.error,'Closed account must fail a new real password login');
 assert.equal(attempted.data.session,null);
 checks.push('real_browser_fresh_password_proof_closes_only_own_customer_account','existing_session_authority_revoked','new_real_password_signin_denied_after_closure');
 return {checks};
}
