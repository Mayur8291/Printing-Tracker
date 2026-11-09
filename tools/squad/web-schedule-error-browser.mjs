/** Actual weekly/warehouse shared controls with explicit local failure transport.
 * No hosted SDK, schedule mutation, email or worker execution. */
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:5183';
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
const React=await import('/node_modules/.vite/deps/react.js'),ReactDOM=await import('/node_modules/.vite/deps/react-dom_client.js');await import('/src/styles.css');await import('/src/index.css');await import('/src/squad/squad.css');
const source=await(await fetch('/src/squad/features/administration/IntegrationsPanel.jsx')).text(),hooksUrl=source.match(/from "([^"]*hooks[^"]*)"/)[1],hooksSource=await(await fetch(hooksUrl)).text(),queryUrl=hooksSource.match(/from "([^"]*tanstack_react-query[^"]*)"/)[1];
const{QueryClient,QueryClientProvider}=await import(queryUrl),{SquadContext}=await import(hooksUrl),{default:Panel}=await import('/src/squad/features/administration/IntegrationsPanel.jsx');
const h=React.default.createElement,root=ReactDOM.default.createRoot(document.getElementById('root'));let revision=0;
window.mount=(mode='write-error')=>{window.calls=[];window.reads=0;window.recover=false;let enabled=false;const failure=()=>Object.assign(new Error('UPDATE requires a WHERE clause'),{code:'21000',kind:'unknown'});const sdk={settings:async()=>({warehouse_provider:'unicommerce'}),weeklyTailorSchedule:async()=>{window.reads++;if(mode==='read-error'&&!window.recover)throw failure();return{enabled,version:enabled?'1:2':'1:1',next_week_start:'2026-11-14',error_code:null};},warehouseSchedule:async()=>({enabled:false,version:'1:1'}),mailSettings:async()=>({data:[]}),configureWeeklyTailorSchedule:async(value,command)=>{window.calls.push({value,command});await new Promise(r=>setTimeout(r,30));if(window.calls.length===1)throw failure();enabled=value;return{enabled,version:'1:2'};}};const canWrite=mode!=='mirror';const context={sdk,scope:'schedule-local-'+(++revision),canWrite,writeState:{mode:canWrite?'native':'mirror',allowed:canWrite},identity:{id:'1',role:0},environment:'staging'};
root.render(h(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},h(SquadContext.Provider,{value:context},h('main',{key:revision,className:'squad-app p-5'},h(Panel,{sdk,canWrite})))));};
window.mount();</script></body></html>`;
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage(),errors=[],external=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Local fixture error:',e.message);});
 await page.setRequestInterception(true);page.on('request',request=>{const u=new URL(request.url());if(u.origin===base&&u.pathname==='/__schedule-error-proof'){void request.respond({status:200,contentType:'text/html',body:html});return;}if(u.origin===base||['data:','blob:','about:'].includes(u.protocol)){void request.continue();return;}external.push(u.origin);void request.abort();});
 await page.setViewport({width:1440,height:1000});await page.goto(base+'/__schedule-error-proof',{waitUntil:'networkidle0'});
 const section=()=>page.evaluateHandle(()=>[...document.querySelectorAll('h2,h3')].find(n=>n.textContent==='Weekly tailor reports').closest('section'));
 const click=async(text,scope='[role=dialog]')=>{await page.waitForFunction((text,scope)=>[...document.querySelectorAll(scope+' button')].some(n=>n.textContent.trim()===text&&!n.disabled),{},text,scope);const button=await page.evaluateHandle((text,scope)=>[...document.querySelectorAll(scope+' button')].find(n=>n.textContent.trim()===text&&!n.disabled),text,scope);try{await button.asElement().click();}finally{await button.dispose();}};
 await page.waitForFunction(()=>[...document.querySelectorAll('h2,h3')].some(n=>n.textContent==='Weekly tailor reports'));
 let card=await section();await card.asElement().$('button').then(b=>b.click());await click('Save changes');
 await page.waitForSelector('[role=dialog] [role=alert]');assert.equal(await page.$eval('[role=dialog] [role=alert]',n=>n.textContent),'UPDATE requires a WHERE clause');
 assert.equal(await page.evaluate(()=>window.calls.length),1);assert.equal(await card.evaluate(n=>n.textContent.includes('Disabled')),true);
 assert.equal(await page.$eval('[role=dialog] button[type=submit]',n=>n.disabled),false);
 await page.setViewport({width:360,height:800});await page.waitForFunction(()=>getComputedStyle(document.querySelector('[role=dialog]')).opacity==='1');await page.screenshot({path:'/tmp/squad-weekly-schedule-error-360.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 await click('Save changes');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
 const calls=await page.evaluate(()=>window.calls);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].command.expectedVersion,'1:1');
 await page.waitForFunction(()=>[...document.querySelectorAll('h2,h3')].find(n=>n.textContent==='Weekly tailor reports').closest('section').textContent.includes('Enabled'));await card.dispose();
 await page.evaluate(()=>window.mount('read-error'));await page.waitForFunction(()=>[...document.querySelectorAll('h2,h3')].find(n=>n.textContent==='Weekly tailor reports').closest('section').querySelector('[role=alert]'));
 card=await section();assert.equal(await card.evaluate(n=>[...n.querySelectorAll('button')].some(b=>b.textContent==='Enable schedule')),false);assert.equal(await page.evaluate(()=>window.reads),1);
 await page.evaluate(()=>window.recover=true);await card.asElement().$('button').then(b=>b.click());await page.waitForFunction(()=>[...document.querySelectorAll('h2,h3')].find(n=>n.textContent==='Weekly tailor reports').closest('section').textContent.includes('Enable schedule'));await card.dispose();
 await page.evaluate(()=>window.mount('mirror'));await page.waitForFunction(()=>[...document.querySelectorAll('h2,h3')].find(n=>n.textContent==='Weekly tailor reports').closest('section').querySelector('button')?.disabled===true);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log(JSON.stringify({passed:true,checks:['write_failure_retains_confirmation_and_disabled_state','explicit_error_and_reenabled_retry','no_automatic_command_retry','identical_manual_retry_preserves_key_and_version','success_refetches_and_closes','read_failure_retry_without_mutation','mirror_disables_schedule_control','360px_error_dialog_without_overflow'],scope:'Actual React controls with local SDK failures; not hosted scheduling or email proof'}));
}finally{await browser.close();}
