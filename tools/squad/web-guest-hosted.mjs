/** Real guest UI acceptance; Python owns capability, actual mail send and cleanup.
 * stdout is a bounded control protocol. Never write passwords, codes or tokens.
 */
import assert from 'node:assert/strict';
import readline from 'node:readline';
import puppeteer from 'puppeteer';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient} from '../../packages/shared/squad.js';
import {runAccountEntry} from './web-account-entry-adapter.mjs';
import {guestFailureDiagnostic} from './guest-failure-diagnostics.mjs';
const stream=readline.createInterface({input:process.stdin}),input=stream[Symbol.asyncIterator]();
const receive=async()=>{const line=await input.next();assert.ok(!line.done,'Host control channel closed');return JSON.parse(line.value);};
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const config=await receive(),base='http://localhost:5183';
assert.equal(config.url,'https://scvojtvgnkmbupvyslmb.supabase.co');
assert.equal(config.format,'squad-guest-browser/v1');
assert.deepEqual(Object.keys(config.flows).sort(),['confirm','invite','recovery','register']);
const flowOrder=['register','confirm','recovery','invite'];
assert.ok(Array.isArray(config.requested_flows)&&config.requested_flows.length);
assert.deepEqual(config.requested_flows,flowOrder.filter(kind=>config.requested_flows.includes(kind)),'Selected guest flows must be distinct and canonical');
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const errors=[],violations=[],results=[];
let diagnosticKind=null,diagnosticStage='initializing';
const stage=value=>{diagnosticStage=value;};
const client=()=>createClient(config.url,config.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
async function pageFor(flowId){
 const context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport({width:1440,height:1000});
 await page.evaluateOnNewDocument(id=>Object.defineProperty(crypto,'randomUUID',{value:()=>id}),flowId);
 page.on('pageerror',error=>errors.push(error.message));
 await page.setRequestInterception(true);page.on('request',request=>{
  const url=new URL(request.url());
  if(!['localhost','127.0.0.1','scvojtvgnkmbupvyslmb.supabase.co'].includes(url.hostname)&&!['data:','blob:','about:'].includes(url.protocol)){violations.push(url.hostname);void request.abort();return;}
  if(url.pathname.startsWith('/rest/v1/')&&!url.pathname.startsWith('/rest/v1/rpc/'))violations.push('raw_table_access');
  void request.continue();
 });return page;
}
async function clickLabel(page,label){
 await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===label&&!b.disabled),{},label);
 await page.evaluate(label=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label&&!b.disabled).click(),label);
}
async function inviteFromAdmin(){
 const page=await pageFor(config.flows.invite.id),actor=config.actors.admin;
 await page.goto(base+'/squad/people/'+config.actors.invite.id,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#login-email');await page.type('#login-email',actor.email);await page.type('#login-password',actor.password);
 await page.click('button[type=submit]');await page.waitForSelector('.squad-app',{timeout:40000});
 await page.goto(base+'/squad/people/'+config.actors.invite.id,{waitUntil:'domcontentloaded'});
 await clickLabel(page,'Send invitation');await page.waitForSelector('[role=dialog]');
 await page.type('[role=dialog] [name=reason]','Synthetic guest invitation acceptance');
 const sent=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/functions/v1/squad-account/users/invite');
 await clickLabel(page,'Save changes');const response=await sent;assert.equal(response.ok(),true);const result=await response.json();
 assert.equal(result.request_id,config.flows.invite.id);assert.equal(result.accepted,true);await page.close();
}
try{
 for(const kind of config.requested_flows){
  diagnosticKind=kind;stage('initializing');
  const flow=config.flows[kind],actor=config.actors[kind];
  assert.match(flow.id,/^[0-9a-f-]{36}$/);assert.match(flow.email,new RegExp(`^squad-guest-[0-9a-f]{32}-${kind}@mailinator\\.com$`));
  let previous,previousSession;
  if(kind==='recovery'){
   stage('recovery_old_login');
   previous=client();const login=await previous.auth.signInWithPassword({email:actor.email,password:actor.password});assert.equal(login.error,null);previousSession=login.data.session;
   stage('recovery_old_identity');assert.equal((await createSquadClient(previous).me()).id,String(actor.id));
  }
  if(kind==='invite'){stage('invitation_request');await inviteFromAdmin();}
  const page=await pageFor(flow.id);
  const result=await runAccountEntry({base,accountEntry:{page,onStage:stage,scenario:{kind,email:flow.email,password:flow.password,profile:config.profile,requestId:flow.id},
   assertOwnedScenario:async()=>{emit({phase:'assert_scope',kind});const reply=await receive();assert.equal(reply.ready,true);},
   recordRequest:async id=>{assert.equal(id,flow.id);emit({phase:'request_recorded',kind,id});const reply=await receive();assert.equal(reply.recorded,true);},
   readCode:async({kind:purpose,email,requestId})=>{assert.equal(purpose,kind);assert.equal(email,flow.email);assert.equal(requestId,flow.id);emit({phase:'mail_proof',kind,id:flow.id});const proof=await receive();assert.equal(proof.recipient,email);assert.equal(proof.messageId,`<squad-${flow.id}@scottinternational.com>`);assert.match(proof.code,/^\d{8}$/);return proof.code;},
   recordCompletion:async receipt=>{emit({phase:'completion_recorded',kind,receipt});const reply=await receive();assert.equal(reply.recorded,true);},
   verifyCompletion:async receipt=>{
    stage('new_password_login');
    const fresh=client(),login=await fresh.auth.signInWithPassword({email:flow.email,password:flow.password});
    if(kind==='register'){stage('pending_approval_check');assert.equal(receipt.next,'await_approval');assert.ok(login.error,'Pending business approval must block real Auth login');return{passed:true,checks:['real_auth_blocks_pending_approval']};}
    assert.equal(login.error,null);assert.equal(login.data.user.id,actor.auth_id);assert.equal(login.data.user.role,'sa_app');
    stage('new_identity');const me=await createSquadClient(fresh).me();assert.equal(me.id,String(actor.id));assert.equal(me.role,3);assert.equal(me.email,flow.email);
    stage('previous_password_login');
    const old=await client().auth.signInWithPassword({email:flow.email,password:actor.password});assert.ok(old.error,'Previous password remains usable');
    const checks=['real_auth_new_password','real_auth_old_password_refused','mapped_customer_identity'];
    if(previous){
     stage('previous_session_read');
     let rejected=false;try{await createSquadClient(previous).me();}catch{rejected=true;}assert.ok(rejected,'Previous live session remains authorized after recovery');
     stage('previous_refresh');const renewed=await client().auth.refreshSession({refresh_token:previousSession.refresh_token});assert.ok(renewed.error,'Previous refresh token remains usable after recovery');checks.push('previous_session_and_refresh_refused');
    }
    stage('fresh_logout');await fresh.auth.signOut({scope:'local'});return{passed:true,checks};
   }
  }});
  stage('flow_record');results.push(result);await page.close();emit({phase:'flow_passed',kind,result});assert.equal((await receive()).recorded,true);
 }
 stage('final_browser_checks');assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);emit({phase:'complete',results});
}catch(error){emit({phase:'failed',error:'Guest browser acceptance failed',diagnostic:guestFailureDiagnostic(error,{kind:diagnosticKind,stage:diagnosticStage})});process.exitCode=1;}
finally{await browser.close();stream.close();}
