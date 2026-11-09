/** Actual AppRoot, real SDK and delayed synthetic transport; no hosted state. */
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'), scratch=await fs.mkdtemp(path.join(os.tmpdir(),'squad-session-coalescing-'));
const source=process.env.SQUAD_SESSION_CANDIDATE;
const transport=`
window.probe={calls:[],active:{},max:{},mounts:0};
window.authState={session:{access_token:'synthetic-a1',user:{id:'synthetic-a',role:'sa_app'}},version:'1:1',configure:true,sessionDelay:0,userError:false,userOverride:null};
let listener;
window.emitAuth=(event,patch={})=>{Object.assign(window.authState,patch);listener(event,window.authState.session);};
const clone=v=>JSON.parse(JSON.stringify(v));
async function read(name,value,delay=120){const p=window.probe;p.calls.push({name,event:'start',at:performance.now()});p.active[name]=(p.active[name]||0)+1;p.max[name]=Math.max(p.max[name]||0,p.active[name]);const result=value();await new Promise(r=>setTimeout(r,delay));p.active[name]--;p.calls.push({name,event:'end',at:performance.now()});return result;}
export const supabase={auth:{
 getSession:()=>read('getSession',()=>({data:{session:clone(window.authState.session)},error:null}),window.authState.sessionDelay),
 getUser:()=>read('getUser',()=>({data:{user:clone(window.authState.userOverride||window.authState.session?.user||null)},error:window.authState.userError?new Error('synthetic validation denied'):null})),
 onAuthStateChange(callback){listener=callback;queueMicrotask(()=>callback('INITIAL_SESSION',window.authState.session));return {data:{subscription:{unsubscribe(){listener=()=>{};}}}};},
 async signOut(){window.emitAuth('SIGNED_OUT',{session:null});return {error:null};}
},schema:()=>({rpc:name=>read(name,()=>({data:name==='v1_me'?{id:window.authState.session.user.id==='synthetic-a'?'1':'2',auth_id:window.authState.session.user.id,role:3,version:window.authState.version,capabilities:{configure:window.authState.configure},write_state:window.authState.writeState?{...window.authState.writeState,allowed:Date.now()<Date.parse(window.authState.writeState.expires_at)}:{mode:'mirror',allowed:false}}:{api_version:1,update_required:false},error:null}))})};`;
const modules={
 '../supabaseClient':transport,
 '../runtimeEnv':`export const getRuntimeEnv=()=>({env:'staging'});`,
 '../App':`export default function Stub(){return null;}`,
 '../squad/SquadApp':`import React,{useEffect}from'react';import{useSquad}from'${root}/apps/admin/src/squad/data/hooks.js';export default function Stub(){const c=useSquad();window.gateway=c;useEffect(()=>{window.probe.mounts++;},[]);return React.createElement('div',{'data-squad-probe':true,'data-auth':c.identity.auth_id,'data-configure':String(c.identity.capabilities.configure),'data-version':c.identity.version,'data-allowed':String(c.canWrite)},'ready');}`,
 './AccountFlow':`export default function Stub(){return null;}`,
 '../components/auth/LoginPage':`import React from'react';export default function Stub(){return React.createElement('div',{'data-anonymous':true},'Sign in');}`,
 '../components/ui/button':`import React from'react';export const Button=props=>React.createElement('button',props);`,
 './WorkspaceErrorBoundary':`export default function Stub({children}){return children;}`,
};
await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import AppRoot from'${root}/apps/admin/src/application/AppRoot.jsx';const mount=createRoot(document.getElementById('root'));window.unmountApp=()=>mount.unmount();mount.render(<React.StrictMode><AppRoot/></React.StrictMode>);`,resolveDir:root,loader:'jsx'},outfile:path.join(scratch,'app.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',alias:{react:path.join(root,'node_modules/react'),'react-dom':path.join(root,'node_modules/react-dom')},define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'local-boundaries',setup(b){b.onResolve({filter:/.*/},args=>Object.hasOwn(modules,args.path)?{path:args.path,namespace:'probe'}:undefined);b.onLoad({filter:/.*/,namespace:'probe'},args=>({contents:modules[args.path],loader:'js',resolveDir:root}));if(source)b.onLoad({filter:/application\/AppRoot\.jsx$/},async()=>({contents:await fs.readFile(source,'utf8'),loader:'jsx',resolveDir:path.join(root,'apps/admin/src/application')}));}}],logLevel:'silent'});
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const checks=[];
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',async r=>{const u=new URL(r.url());if(u.origin!=='http://session-probe.invalid'){await r.abort();return;}await r.respond({status:200,contentType:u.pathname.endsWith('/app.js')?'text/javascript':'text/html',body:u.pathname.endsWith('/app.js')?await fs.readFile(path.join(scratch,'app.js')):'<html><body><div id="root"></div><script src="/app.js"></script></body></html>'});});
 const settle=async()=>{await page.waitForFunction(()=>Object.values(window.probe.active).every(n=>n===0));await new Promise(r=>setTimeout(r,40));await page.waitForFunction(()=>Object.values(window.probe.active).every(n=>n===0));};
 const count=name=>page.evaluate(name=>window.probe.calls.filter(c=>c.name===name&&c.event==='start').length,name);
 const state=()=>page.evaluate(()=>{const e=document.querySelector('[data-squad-probe]');return e?{auth:e.dataset.auth,configure:e.dataset.configure,version:e.dataset.version}:null;});
 const focus=()=>page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
 await page.goto('http://session-probe.invalid/squad/home');await page.waitForSelector('[data-squad-probe]');await settle();
 for(const name of ['getUser','v1_me','v1_app_bootstrap'])assert.equal(await count(name),1,name);
 checks.push('initial getSession plus INITIAL_SESSION shares one verified identity/bootstrap check');
 let before=await count('v1_me');const mounts=await page.evaluate(()=>window.probe.mounts);await focus();await settle();assert.equal(await count('v1_me'),before+1);assert.equal(await page.evaluate(()=>window.probe.mounts),mounts);
 checks.push('paired focus and visibility coalesce without remounting unchanged scope');
 before=await count('v1_me');await page.evaluate(()=>{window.authState.configure=false;});await focus();await settle();assert.equal(await count('v1_me'),before+1);assert.equal((await state()).configure,'false');
 checks.push('completed checks are never cached; foreground revocation changes current access');
 await page.evaluate(()=>{window.authState.configure=true;window.dispatchEvent(new Event('focus'));});
 await page.waitForFunction(()=>window.probe.active.v1_me===1);
 await page.evaluate(()=>window.emitAuth('USER_UPDATED',{configure:false,version:'1:2'}));await settle();assert.deepEqual(await state(),{auth:'synthetic-a',configure:'false',version:'1:2'});
 checks.push('same-token USER_UPDATED invalidates an older pending authorization response');
 before=await count('v1_me');await focus();await page.waitForFunction(()=>window.probe.active.getUser===1);
 await page.evaluate(()=>window.emitAuth('TOKEN_REFRESHED',{session:{access_token:'synthetic-a2',user:{id:'synthetic-a',role:'sa_app'}},version:'1:3'}));await settle();assert.equal(await count('v1_me'),before+1);assert.equal((await state()).version,'1:3');
 checks.push('token refresh restarts validation and prevents superseded getUser from launching RPCs');
 await focus();await page.waitForFunction(()=>window.probe.active.v1_me===1);await page.evaluate(()=>window.emitAuth('SIGNED_OUT',{session:null}));await page.waitForSelector('[data-anonymous]');await settle();assert.equal(await state(),null);
 checks.push('SIGNED_OUT clears access immediately and late identity responses cannot restore it');
 await page.evaluate(()=>window.emitAuth('SIGNED_IN',{session:{access_token:'synthetic-b1',user:{id:'synthetic-b',role:'sa_app'}},version:'2:1',configure:true}));await page.waitForSelector('[data-squad-probe]');await settle();assert.equal((await state()).auth,'synthetic-b');
 checks.push('new login validates and mounts only the new account scope');
 await page.evaluate(()=>window.emitAuth('SIGNED_IN',{session:{access_token:'synthetic-a3',user:{id:'synthetic-a',role:'sa_app'}},version:'1:4'}));
 await page.waitForFunction(()=>!document.querySelector('[data-squad-probe]'));assert.ok(await page.evaluate(()=>document.body.textContent.includes('Checking your session')));
 await page.waitForSelector('[data-squad-probe]');await settle();assert.equal((await state()).auth,'synthetic-a');
 checks.push('direct different-account SIGNED_IN clears the prior UI before verification completes');
 await page.evaluate(()=>{window.authState.sessionDelay=180;window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>window.probe.active.getSession===1);await page.evaluate(()=>window.emitAuth('SIGNED_OUT',{session:null}));await settle();assert.equal(await state(),null);
 checks.push('late getSession result from before logout cannot restart workspace validation');
 await page.evaluate(()=>window.emitAuth('SIGNED_IN',{sessionDelay:0,session:{access_token:'synthetic-b2',user:{id:'synthetic-b',role:'sa_app'}},version:'2:2'}));await page.waitForSelector('[data-squad-probe]');await settle();
 await page.evaluate(()=>{window.authState.configure=false;window.gateway.refreshIdentity();});await settle();assert.equal((await state()).configure,'false');
 checks.push('explicit authorization refresh observes changed server capability');
 await page.evaluate(()=>{window.authState.writeState={mode:'test',allowed:true,expires_at:new Date(Date.now()+500).toISOString()};window.gateway.refreshIdentity();});await settle();
 assert.equal(await page.$eval('[data-squad-probe]',e=>e.dataset.allowed),'true');await new Promise(r=>setTimeout(r,45));await focus();
 await page.waitForFunction(()=>document.querySelector('[data-squad-probe]')?.dataset.allowed==='false');await settle();
 checks.push('write lease expiry forces a fresh check instead of joining a pre-expiry allowed response');
 await page.evaluate(()=>{window.authState.writeState=null;window.authState.userOverride={id:'different-account',role:'sa_app'};window.gateway.refreshIdentity();});await settle();assert.equal(await state(),null);assert.ok(await page.evaluate(()=>document.body.textContent.includes('Your account changed')));
 checks.push('verified Auth user differing from session snapshot cannot enter either account workspace');
 await page.evaluate(()=>{window.authState.userOverride=null;window.dispatchEvent(new Event('focus'));});await page.waitForSelector('[data-squad-probe]');await settle();
 await page.evaluate(()=>{window.authState.userError=true;window.dispatchEvent(new Event('focus'));});await settle();assert.equal(await state(),null);assert.ok(await page.evaluate(()=>document.body.textContent.includes('synthetic validation denied')));
 checks.push('failed verification removes the workspace rather than retaining stale access');
 await page.evaluate(()=>{window.authState.userError=false;window.dispatchEvent(new Event('focus'));});await page.waitForSelector('[data-squad-probe]');await settle();await page.evaluate(()=>window.gateway.onSignOut());await page.waitForSelector('[data-anonymous]');await settle();assert.equal(await state(),null);
 checks.push('local sign-out callback invalidates the session and clears the workspace');
 await page.evaluate(()=>window.emitAuth('SIGNED_IN',{session:{access_token:'synthetic-b3',user:{id:'synthetic-b',role:'sa_app'}},version:'2:3'}));await page.waitForSelector('[data-squad-probe]');await settle();
 before=await count('v1_me');await focus();await page.waitForFunction(()=>window.probe.active.getUser===1);await page.evaluate(()=>window.unmountApp());await settle();assert.equal(await count('v1_me'),before);assert.equal(await state(),null);
 checks.push('StrictMode cleanup and explicit unmount prevent late getUser from launching identity reads');
 assert.deepEqual(errors,[]);const report={status:'passed',scope:'Actual AppRoot with synthetic delayed Auth/RPC; no hosted requests or SQL performance attribution.',checks};await fs.writeFile('/tmp/squad-session-coalescing.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await fs.rm(scratch,{recursive:true,force:true});}
