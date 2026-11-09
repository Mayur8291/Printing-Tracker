/** Actual recovery form + actual shared SDK, local mocked HTTP boundary only.
 * No email/Auth/provider/staging calls; this tests selectors and diagnostic stages. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {runAccountEntry} from './web-account-entry-adapter.mjs';
import {guestFailureDiagnostic} from './guest-failure-diagnostics.mjs';
const base='http://localhost:5183',requestId='11111111-1111-4111-8111-111111111111';
const sdkFile=new URL('../../packages/shared/squad.js',import.meta.url).pathname;
const html=`<!doctype html><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
const React=await import('/node_modules/.vite/deps/react.js'),ReactDOM=await import('/node_modules/.vite/deps/react-dom_client.js');
const {default:AccountFlow}=await import('/src/application/AccountFlow.jsx');const {createSquadClient}=await import(${JSON.stringify('/@fs'+sdkFile)});
Object.defineProperty(crypto,'randomUUID',{value:()=>${JSON.stringify(requestId)}});
const sdk=createSquadClient({schema:()=>({}),functions:{invoke:async(name,options)=>{const r=await fetch('/functions/v1/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(options.body)});return r.ok?{data:await r.json(),error:null}:{data:null,error:{context:r}};}}});
ReactDOM.default.createRoot(document.getElementById('root')).render(React.default.createElement(AccountFlow,{sdk,kind:'recovery',onBack:()=>{}}));
</script>`;
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const results=[];
 for(const failStatus of [false,true]){
  const page=await browser.newPage();await page.setViewport({width:390,height:844});page.setDefaultTimeout(1000);
  const errors=[],requests=[],stages=[];page.on('pageerror',e=>errors.push(e.name));
  await page.setRequestInterception(true);page.on('request',request=>{
   const url=new URL(request.url());
   if(url.origin!==base){void request.abort();return;}
   if(url.pathname==='/account/recovery'){void request.respond({status:200,contentType:'text/html',body:html});return;}
   if(url.pathname==='/functions/v1/squad-account/recovery'){
    const body=JSON.parse(request.postData());requests.push(body.action);
    const rejected=body.action==='complete'&&body.code!=='12345678';
    const result=body.action==='request'?{accepted:true}:rejected?{error:'INVALID_OR_EXPIRED_CODE'}:{completed:true,user_id:'103',next:'sign_in',email_confirmed:true};
    void request.respond({status:rejected?400:200,contentType:'application/json',body:JSON.stringify(result)});return;
   }
   void request.continue();
  });
  let current='initializing';
  const task=runAccountEntry({base,accountEntry:{page,scenario:{kind:'recovery',email:'local-fixture@example.invalid',password:'Local-only-password-123',requestId},
   onStage:s=>{current=s;stages.push(s);},assertOwnedScenario:async()=>{},recordRequest:async id=>assert.equal(id,requestId),
   readCode:async()=> '12345678',recordCompletion:async receipt=>{assert.equal(receipt.completed,true);if(failStatus)await page.evaluate(()=>{document.querySelector('[role=status]')?.remove();new MutationObserver(()=>document.querySelector('[role=status]')?.remove()).observe(document.body,{childList:true,subtree:true});});},
   verifyCompletion:async receipt=>{assert.equal(receipt.user_id,'103');return{passed:true,scope:'Local mock HTTP fixture; not real Auth acceptance'};}}});
  if(failStatus){let failure;try{await task;}catch(e){failure=guestFailureDiagnostic(e,{kind:'recovery',stage:current});}assert.ok(failure);assert.equal(failure.stage,'completion_status');assert.equal(failure.type,'TimeoutError');assert.ok(failure.frames.some(f=>f.file==='web-account-entry-adapter.mjs'));results.push('missing_completion_status_has_precise_secret_free_diagnostic');}
  else{const result=await task;assert.equal(result.kind,'recovery');assert.deepEqual(requests,['request','complete','complete']);assert.ok(stages.includes('wrong_proof_response'));assert.ok(stages.includes('authority_verification'));results.push('real_recovery_form_request_mismatch_wrong_code_correction_and_completion');}
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log(JSON.stringify({passed:true,checks:results,hosted_calls:0,emails_sent:0,auth_acceptance:false}));
}finally{await browser.close();}
