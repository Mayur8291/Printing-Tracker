/** Parent-owned staging fixture protocol; read-only UI acceptance, no fixture
 * creation/recovery and no application mutations. Credentials enter over stdin.
 * Playwright engines live outside the workspace; WebKit is NOT native Safari. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {navigationFor} from '../../apps/admin/src/squad/navigation/registry.js';
import {inspect,violations} from './web-navigation-hosted-journey.mjs';
import {transportAllowed,STAGING_ORIGIN} from './web-cross-browser-policy.mjs';
import {observeBrowserErrors} from './browser-error-observer.mjs';

const ROLES=[0,1,2,3,4,7,8,9,10,11,12];
export function validateFrontendBinding(frontend,base,release=null) {
 const u=new URL(base);assert.ok(!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/');
 assert.equal(base,u.origin,'Use a canonical origin without a trailing path');
 if(release){
  assert.deepEqual(Object.keys(release).sort(),['base','deployment_id','entry_path','entry_sha256','format','git_commit']);
  assert.equal(release.format,'squad-reviewed-deployed-frontend/v1');assert.equal(release.base,base);
  assert.equal(u.protocol,'https:');assert.equal(u.port,'');
  assert.ok(u.hostname==='scottdashboard.vercel.app'||/^scottdashboard-[a-z0-9-]+-mayur8291s-projects\.vercel\.app$/.test(u.hostname));
  assert.match(release.git_commit,/^[0-9a-f]{40}$/);assert.match(release.deployment_id,/^dpl_[A-Za-z0-9]{8,100}$/);
  assert.match(release.entry_path,/^\/assets\/index-[A-Za-z0-9_-]+\.js$/);
  assert.deepEqual(frontend,{base:release.base,entry_path:release.entry_path,entry_sha256:release.entry_sha256});
 }else{assert.equal(u.protocol,'http:');assert.ok(['localhost','127.0.0.1'].includes(u.hostname));assert.ok(u.port&&Number(u.port)>0&&Number(u.port)<=65535);}
 if(frontend){assert.deepEqual(Object.keys(frontend).sort(),['base','entry_path','entry_sha256']);assert.equal(frontend.base,base);assert.match(frontend.entry_path,/^\/(?:assets\/index-[A-Za-z0-9_-]+\.js|src\/main\.jsx(?:\?t=\d{10,16})?)$/);assert.match(frontend.entry_sha256,/^[0-9a-f]{64}$/);}
 return base;
}

export function stagingFrontendInit(){
 // Apply before any application module, including production-mode Vercel builds.
 localStorage.setItem('scott-dashboard-env-override','staging');
}

export async function runCrossBrowser(config,{playwright,engines=['firefox','webkit'],base='http://localhost:5183'}={}) {
 assert.equal(config.url,STAGING_ORIGIN);assert.match(config.run_id,/^[0-9a-f-]{36}$/);
 assert.deepEqual([...config.actors.map(a=>a.role)].sort((a,b)=>a-b),ROLES);
 validateFrontendBinding(config.frontend,base,config.release);
 assert.ok(engines.length&&engines.every(e=>['firefox','webkit'].includes(e)));
 const directory=path.resolve('tools/squad/private',`web-cross-browser-${config.run_id}`);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.chmodSync(directory,0o700);
 const report={scope:'Real staging login, read-only navigation, 360px, keyboard and unsaved core forms. WebKit engine, not native Safari.',engines:[],failures:[],screenshotsPrivate:true,...(config.release?{release:config.release}:{}),...(config.frontend?{frontend:config.frontend}:{})};
 const save=()=>fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
 for(const name of engines){
  const browser=await playwright[name].launch({headless:true});
  const result={name,version:browser.version(),roles:[],networkViolations:[]};report.engines.push(result);
  try{for(const actor of config.actors){
   const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage();
   const row={role:actor.role,routes:[],checks:[],errors:[]};result.roles.push(row);
   await context.addInitScript(stagingFrontendInit);
   const errorObserver=await observeBrowserErrors(page,{engine:name,sensitive:[actor.email,actor.password]});
   await context.route('**/*',async route=>{const request=route.request();
    if(!transportAllowed({url:request.url(),method:request.method(),body:request.postData()},base)){
     const parsed=new URL(request.url());result.networkViolations.push({role:actor.role,method:request.method(),origin:parsed.origin,path:parsed.pathname});await route.abort();
    }else await route.continue();
   });
   async function settled(href){
    await page.waitForFunction(expected=>location.pathname===expected&&!!document.querySelector('.squad-app'),href,{timeout:35000});
    await page.waitForFunction(()=>{const m=document.getElementById('squad-main');return m&&!m.innerText.includes('Loading workspace…')&&![...m.querySelectorAll('[aria-busy=true]')].some(n=>n.getBoundingClientRect().height>0);},null,{timeout:35000});
    await page.waitForLoadState('networkidle',{timeout:6000}).catch(()=>{});
   }
   async function capture(label){const filename=path.join(directory,`${name}-role-${actor.role}-${label}.png`);await page.screenshot({path:filename});fs.chmodSync(filename,0o600);return filename;}
   try{
    const entryResponse=config.frontend?page.waitForResponse(r=>r.request().method()==='GET'&&r.url()===base+config.frontend.entry_path,{timeout:15000}):null;
    entryResponse?.catch(()=>{});
    await page.goto(base+'/squad/home',{waitUntil:'domcontentloaded'});
    if(entryResponse){const response=await entryResponse;assert.equal(response.status(),200);const bytes=await response.body();assert.ok(bytes.length<=10_000_000);const hash=createHash('sha256').update(bytes).digest('hex');assert.equal(hash,config.frontend.entry_sha256,'Application entry changed');row.entry_sha256=hash;}
    await page.locator('#login-email').fill(actor.email);await page.locator('#login-password').fill(actor.password);
    const meResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/v1_me'&&r.request().method()==='POST'&&r.status()===200,{timeout:40000});
    await page.locator('button[type=submit]').click();const me=await (await meResponse).json();
    assert.equal(me.role,actor.role);assert.equal(me.auth_id,actor.auth_id);assert.equal(String(me.id),String(config.fixture.actors[String(actor.role)]));
    for(const item of navigationFor(me)){
     const start=performance.now();await page.goto(new URL(item.href,base).href,{waitUntil:'domcontentloaded'});await settled(item.href);
     const state=await inspect(page),issues=violations(state);row.routes.push({route:item.href,elapsed_ms:Math.round(performance.now()-start),issues});
     if(issues.length)report.failures.push({engine:name,role:actor.role,route:item.href,issues});
    }
    await page.locator('a[href="#squad-main"]').focus();await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>document.activeElement?.id==='squad-main'),true);row.checks.push('skip_link_keyboard_focus');
    await page.setViewportSize({width:360,height:844});await page.goto(base+'/squad/home');await settled('/squad/home');
    assert.deepEqual(violations(await inspect(page)),[]);row.mobileScreenshot=await capture('home-360');
    await page.locator('[data-sidebar="trigger"]').focus();await page.keyboard.press('Enter');
    const drawer=page.locator('[data-mobile="true"]');await drawer.waitFor({state:'visible'});
    await drawer.locator('a[href="/squad/profile"]').click();await settled('/squad/profile');await drawer.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>document.activeElement?.id==='squad-main'),true);row.checks.push('mobile_keyboard_menu_navigation');
    const displayName=page.getByRole('textbox',{name:'Display name',exact:true});
    if(await displayName.isEnabled()){const original=await displayName.inputValue();await displayName.fill(original+' unsaved');await displayName.fill(original);row.checks.push('profile_control_edit_without_submit');}
    else row.checks.push('profile_control_server_readonly');
    assert.deepEqual(violations(await inspect(page)),[]);row.profileScreenshot=await capture('profile-360');
    if(actor.role===0){
     await page.goto(base+'/squad/administration/settings');await settled('/squad/administration/settings');
     const trigger=page.getByRole('button',{name:'Add city',exact:true});
     if(await trigger.isEnabled()){
      await trigger.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await dialog.waitFor();
      await page.waitForFunction(()=>{const n=document.querySelector('[role=dialog]');return n&&getComputedStyle(n).opacity==='1';});
      const fits=await dialog.evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;});assert.equal(fits,true);
      for(let i=0;i<16;i++)await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[role=dialog]')),true);
      row.dialogScreenshot=await capture('city-dialog-360');await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
      await page.waitForFunction(()=>document.activeElement?.textContent.trim()==='Add city',{},{timeout:3000});row.checks.push('dialog_tab_trap_escape_focus_return');
     }else row.checks.push('city_dialog_server_readonly');
    }
    Object.assign(row,await errorObserver.finish(row.routes.every(route=>route.issues.length===0)));
    assert.deepEqual(row.errors,[]);
   }catch(error){if(!row.pageErrors){Object.assign(row,await errorObserver.finish(false).catch(()=>({errors:[{source:'observer',name:'Error',message:'Native browser error collection failed'}]})));}report.failures.push({engine:name,role:actor.role,error:error.name,message:String(error.message).slice(0,240),screenshot:await capture('failure').catch(()=>null)});}
   finally{await context.close();save();}
   console.error(`${name}: read-only persona ${actor.role} completed`);
  }}finally{await browser.close();}
  if(result.networkViolations.length)report.failures.push({engine:name,issues:['blocked_disallowed_transport'],count:result.networkViolations.length});
 }
 report.finished_at=new Date().toISOString();save();
 return {...(config.release?{release:config.release}:{}),...(config.frontend?{frontend:config.frontend}:{}),passed:report.failures.length===0,report:path.join(directory,'report.json'),engines:report.engines.map(e=>({name:e.name,version:e.version,roles:e.roles.length,routes:e.roles.reduce((n,r)=>n+r.routes.length,0)})),failureGroups:report.failures.length};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.env.PLAYWRIGHT_BROWSERS_PATH??='/tmp/squad-playwright-browsers-1.65.0';
 const playwright=await import(pathToFileURL(process.env.SQUAD_PLAYWRIGHT_MODULE??'/tmp/squad-playwright-1.65.0/node_modules/playwright/index.mjs').href);
 let input='';for await(const chunk of process.stdin)input+=chunk;const config=JSON.parse(input);input='';
 assert.ok(config.frontend,'Parent frontend entry binding is required');
 const result=await runCrossBrowser(config,{playwright,engines:config.browser_engines??['firefox','webkit'],base:config.frontend.base});console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}
