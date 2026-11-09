/** Read-only real-Auth navigation acceptance. The parent owns browser sessions,
 * staging fixtures, cleanup and the test window. Never run this as a fixture seeder.
 * Screenshots can contain real scoped records and are saved ONLY in ignored private/.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {navigationFor,ROLE_NAMES} from '../../apps/admin/src/squad/navigation/registry.js';

const ROLES=[0,1,2,3,4,7,8,9,10,11,12];
const ERROR_COPY=[
 'This workspace could not be displayed','Your workspace is unavailable',
 'Your role does not have access','This page is not available to your account',
 'This workspace is not available for your role','Dealer inventory is available to dealer accounts',
 'We couldn’t load this','We could not load this','This workspace is being prepared',
];
const MUTATION_RPC=/(?:_save|_delete|_archive|_transition|_place|_cancel|_retry|_rebuild|_claim|_complete|_configure|_dispatch|_receive|_consume|_request|_invite|_close)$/;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeFile=value=>String(value).replace(/[^a-zA-Z0-9_-]/g,'_');

export async function inspect(page) {
 return page.evaluate(errorCopy=>{
  const visible=element=>{const r=element.getBoundingClientRect(),style=getComputedStyle(element);return r.width>0&&r.height>0&&style.visibility!=='hidden'&&style.display!=='none';};
  const name=element=>{
   const direct=element.getAttribute('aria-label')?.trim();if(direct)return direct;
   const ids=element.getAttribute('aria-labelledby');if(ids&&ids.split(/\s+/).some(id=>document.getElementById(id)?.textContent.trim()))return 'labelled';
   if(element.labels?.length&&[...element.labels].some(label=>label.textContent.trim()))return 'labelled';
   return (element.tagName==='INPUT'&&['submit','button'].includes(element.type)?element.value:element.tagName==='IMG'?element.alt:element.textContent?.trim())||element.getAttribute('title')||'';
  };
  const main=document.getElementById('squad-main'),text=main?.innerText??document.body.innerText;
  const inputs=[...(main?.querySelectorAll('input:not([type=hidden]),select,textarea')??[])].filter(visible);
  const buttons=[...(main?.querySelectorAll('button,a[href]')??[])].filter(visible);
  const ids=[...document.querySelectorAll('[id]')].map(node=>node.id),duplicates=[...new Set(ids.filter((id,index)=>ids.indexOf(id)!==index))];
  return {
   path:location.pathname,hasWorkspace:!!document.querySelector('.squad-app'),hasMain:!!main,
   headingCount:main?.querySelectorAll('h1').length??0,
   horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,
   mainOverflow:!!main&&main.scrollWidth>main.clientWidth+1,
   fatalCopy:errorCopy.filter(value=>text.includes(value)),
   errorAlerts:[...(main?.querySelectorAll('[role=alert]')??[])].filter(visible).length,
   unnamedFields:inputs.filter(element=>!name(element)).map(element=>({tag:element.tagName,type:element.type||null})),
   unnamedActions:buttons.filter(element=>!name(element)).map(element=>({tag:element.tagName})),
   missingImageAlternatives:[...(main?.querySelectorAll('img')??[])].filter(element=>visible(element)&&!element.hasAttribute('alt')).length,
   duplicateIds:duplicates.length,skipLink:!!document.querySelector('a[href="#squad-main"]'),
   loading:[...(main?.querySelectorAll('[aria-busy=true]')??[])].some(visible)||text.includes('Loading workspace…'),
  };
 },ERROR_COPY);
}
async function settle(page,href) {
 await page.waitForFunction(expected=>location.pathname===expected&&!!document.querySelector('.squad-app'),{timeout:25000},href);
 await page.waitForFunction(()=>{
  const main=document.getElementById('squad-main');if(!main)return false;
  return !main.innerText.includes('Loading workspace…')&&![...main.querySelectorAll('[aria-busy=true]')].some(element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0;});
 },{timeout:25000});
 // Include completion of secondary media/options requests, without waiting for live
 // polling forever. An unquiet page is recorded through the route checks below.
 await page.waitForNetworkIdle({idleTime:250,timeout:6000}).catch(()=>{});
 await sleep(80);
}
async function navigate(page,base,href) {
 const handle=await page.$(`[data-sidebar="content"] a[href="${href}"]`);
 if(handle){await handle.click();await handle.dispose();return 'sidebar';}
 await page.goto(new URL(href,base).href,{waitUntil:'domcontentloaded',timeout:30000});return 'document';
}
export function violations(result) {
 const issues=[];
 if(!result.hasWorkspace||!result.hasMain)issues.push('workspace_missing');
 if(result.headingCount!==1)issues.push('one_main_heading_required');
 if(result.horizontalOverflow||result.mainOverflow)issues.push('page_horizontal_overflow');
 if(result.fatalCopy.length)issues.push('visible_route_error');
 if(result.errorAlerts)issues.push('visible_error_alert');
 if(result.unnamedFields.length)issues.push('unlabelled_form_control');
 if(result.unnamedActions.length)issues.push('unnamed_action');
 if(result.missingImageAlternatives)issues.push('missing_image_alternative');
 if(result.duplicateIds)issues.push('duplicate_dom_ids');
 if(!result.skipLink)issues.push('missing_skip_link');
 if(result.loading)issues.push('unresolved_loading_state');
 return issues;
}

export async function runJourney(ctx) {
 assert.equal(typeof ctx.pageFor,'function','Parent must provide real signed-in browser pages');
 const clients=ctx.clientsMap??ctx.clients;assert.ok(clients?.get,'Parent must provide actual SDK identities');
 const base=ctx.base??process.env.SQUAD_WEB_TEST_URL??'http://localhost:5183';
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Use the explicit local UI with staging sessions');
 const directory=path.resolve('tools/squad/private',`web-navigation-${safeFile(ctx.runId??ctx.fixture?.run_id??Date.now())}`);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.chmodSync(directory,0o700);
 const report={scope:'Real staging Auth read-only navigation and responsive/accessibility smoke; not business mutation or WCAG conformance certification',routes:[],mobile:[],dialogs:[],keyboard:[],failures:[],network:[],screenshotsPrivate:true};
 async function screenshot(page,name){const filename=path.join(directory,`${safeFile(name)}.png`);await page.screenshot({path:filename,fullPage:false});fs.chmodSync(filename,0o600);return filename;}
 async function visit(page,role,href,label){
  const start=performance.now();let mode='document',result;
  try{mode=await navigate(page,base,href);await settle(page,href);result=await inspect(page);}
  catch(error){result={path:href,timeout:true,error:error.name||'NavigationError'};}
  const issues=result.timeout?['route_did_not_settle']:violations(result);
  const row={role,route:href,label,mode,elapsed_ms:Math.round(performance.now()-start),...result,issues};report.routes.push(row);
  if(issues.length){row.screenshot=await screenshot(page,`role-${role}-${href}-failure`).catch(()=>null);report.failures.push({role,route:href,issues});}
  return row;
 }
 for(const role of ROLES){
  const identity=clients.get(role)?.me;assert.equal(identity?.role,role,`Missing real role ${role}`);
  const obtained=await ctx.pageFor(role),page=obtained.page??obtained;
  const browserErrors=[],requests=new Map();let currentRoute='entry';
  const onPageError=error=>{browserErrors.push({route:currentRoute,name:error.name||'Error'});};
  const onRequest=request=>{try{const url=new URL(request.url());if(url.hostname.endsWith('.supabase.co')){
   if(url.hostname!=='scvojtvgnkmbupvyslmb.supabase.co')report.failures.push({role,route:currentRoute,issues:['cross_environment_request']});
   if(url.pathname.startsWith('/rest/v1/')&&!url.pathname.startsWith('/rest/v1/rpc/'))report.failures.push({role,route:currentRoute,issues:['raw_table_transport']});
   const rpc=url.pathname.startsWith('/rest/v1/rpc/')?url.pathname.split('/').at(-1):null;
   if(rpc&&request.method()==='POST'){requests.set(request,{rpc,start:performance.now(),route:currentRoute});if(MUTATION_RPC.test(rpc))report.failures.push({role,route:currentRoute,issues:['unexpected_mutation_rpc'],rpc});}
  }}catch{/* Non-URL browser requests do not participate in RPC timing. */}};
  const onResponse=response=>{const request=response.request(),entry=requests.get(request);if(entry){report.network.push({role,route:entry.route,rpc:entry.rpc,status:response.status(),elapsed_ms:Math.round(performance.now()-entry.start)});requests.delete(request);}};
  page.on('pageerror',onPageError);page.on('request',onRequest);page.on('response',onResponse);
  try{
   await page.setViewport({width:1440,height:1000});
   const items=navigationFor(identity);
   for(const item of items){currentRoute=item.href;await visit(page,role,item.href,item.label);}
   const skip=await page.$('a[href="#squad-main"]');
   if(skip){await skip.focus();await page.keyboard.press('Enter');const focused=await page.evaluate(()=>document.activeElement?.id==='squad-main');report.keyboard.push({role,check:'skip_link_keyboard_enter',passed:focused});if(!focused)report.failures.push({role,issues:['skip_link_did_not_focus_main']});await skip.dispose();}
   const actual=await page.$$eval('[data-sidebar="content"] a[href^="/squad/"]',links=>[...new Set(links.map(link=>link.getAttribute('href')))].sort());
   if(JSON.stringify(actual)!==JSON.stringify(items.map(item=>item.href).sort()))report.failures.push({role,issues:['navigation_differs_from_actual_identity']});
   if([0,3,4,10,12].includes(role)){
    currentRoute='/squad/home';await visit(page,role,currentRoute,'Overview responsive check');
    await page.setViewport({width:360,height:844});await sleep(200);
    const state=await inspect(page);const issues=violations(state);const entry={role,viewport:{width:360,height:844},...state,issues,screenshot:await screenshot(page,`role-${role}-mobile-360`)};
    report.mobile.push(entry);if(issues.length)report.failures.push({role,route:currentRoute,issues});
    if(role===3){const theme=await page.$('[aria-label="Use dark appearance"]');if(theme){await theme.click();await sleep(120);entry.darkAppearance=await page.evaluate(()=>document.documentElement.classList.contains('dark'));entry.darkScreenshot=await screenshot(page,'customer-mobile-360-dark');await page.click('[aria-label="Use light appearance"]');}}
    const trigger=await page.$('[data-sidebar="trigger"]');
    if(trigger){await trigger.click();await page.waitForSelector('[data-mobile="true"]',{timeout:5000});await page.waitForFunction(()=>{const drawer=document.querySelector('[data-mobile="true"]');if(!drawer)return false;const rect=drawer.getBoundingClientRect();return drawer.dataset.state==='open'&&rect.left>=0&&rect.right<=innerWidth;},{timeout:5000});const link=await page.$('[data-mobile="true"] a[href="/squad/profile"]');
     if(link){await link.click();await settle(page,'/squad/profile');await page.waitForFunction(()=>!document.querySelector('[data-mobile="true"]'),{timeout:5000});entry.drawerClosesOnNavigation=true;entry.mainFocused=await page.evaluate(()=>document.activeElement?.id==='squad-main');if(!entry.mainFocused)report.failures.push({role,issues:['mobile_route_focus_not_restored']});}
     else{await page.keyboard.press('Escape');report.failures.push({role,issues:['profile_missing_from_mobile_navigation']});}
    }else report.failures.push({role,issues:['mobile_menu_trigger_missing']});
    await page.setViewport({width:1440,height:1000});
   }
   if(role===0){
    for(const suffix of ['settings','jobs','delivery-failures','audit','integrations','transfers','stock']){currentRoute=`/squad/administration/${suffix}`;await visit(page,role,currentRoute,`Administration ${suffix}`);}
    currentRoute='/squad/administration/settings';await visit(page,role,currentRoute,'City dialog check');
    const open=await page.evaluateHandle(()=>[...document.querySelectorAll('#squad-main button')].find(button=>button.textContent.trim()==='Add city'&&!button.disabled));
    const control=open.asElement();if(control){await control.click();await page.waitForSelector('[role="dialog"]',{timeout:5000});await page.setViewport({width:360,height:844});await sleep(200);
     const dialog=await page.evaluate(()=>{const node=document.querySelector('[role="dialog"]'),rect=node.getBoundingClientRect();const submit=node.querySelector('button[type="submit"]');const button=submit?.getBoundingClientRect();return{named:!!node.getAttribute('aria-labelledby'),fits:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight+1,submitVisible:!!button&&button.top>=rect.top&&button.bottom<=rect.bottom};});
     for(let index=0;index<12;index++)await page.keyboard.press('Tab');dialog.focusContained=await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]'));dialog.viewport={width:360,height:844};dialog.screenshot=await screenshot(page,'admin-city-dialog-mobile-360');report.dialogs.push(dialog);
     if(!dialog.named||!dialog.fits||!dialog.submitVisible||!dialog.focusContained)report.failures.push({role,issues:['dialog_accessibility_or_viewport_failure']});
     await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),{timeout:5000});const restored=await page.waitForFunction(()=>document.activeElement?.textContent.trim()==='Add city',{timeout:2000}).then(()=>true,()=>false);report.keyboard.push({role,check:'dialog_escape_returns_trigger_focus',passed:restored});if(!restored)report.failures.push({role,issues:['dialog_trigger_focus_not_restored']});await page.setViewport({width:1440,height:1000});
    }else report.dialogs.push({role,skipped:'Server write state disables the create-city control; did not override permission'});await open.dispose();
   }
   if(browserErrors.length)report.failures.push({role,issues:['browser_javascript_error'],errors:browserErrors});
  }catch(error){report.failures.push({role,route:currentRoute,issues:['navigation_harness_step_failed'],error:error.name||'Error',message:String(error.message||'').slice(0,300),screenshot:await screenshot(page,`role-${role}-step-failure`).catch(()=>null)});}
  finally{page.off('pageerror',onPageError);page.off('request',onRequest);page.off('response',onResponse);await page.setViewport({width:1440,height:1000}).catch(()=>{});}
  console.error(`Read-only navigation checked: ${ROLE_NAMES[role]}`);
 }
 report.networkErrors=report.network.filter(entry=>entry.status>=400);
 if(report.networkErrors.length)report.failures.push({issues:['read_rpc_http_error'],requests:report.networkErrors});
 report.finished_at=new Date().toISOString();report.privateReport=path.join(directory,'report.json');
 fs.writeFileSync(report.privateReport,JSON.stringify(report,null,2),{mode:0o600});
 ctx.recordEvidence?.('web-navigation',report.privateReport);
 if(report.failures.length){const error=new Error(`Navigation acceptance found ${report.failures.length} failure groups; private evidence: ${report.privateReport}`);error.report=report;throw error;}
 return report;
}
