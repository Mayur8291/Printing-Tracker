/** Actual AppRoot lifecycle with delayed local Auth/RPC transport; no server. */
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),scratch=await fs.mkdtemp(path.join(os.tmpdir(),'squad-session-probe-'));
const transport=`window.probe={calls:[],active:{},max:{},mounts:0};window.version='1:1';
const session={access_token:'synthetic-token',user:{id:'synthetic-auth',role:'sa_app'}};
async function read(name,value){const p=window.probe;p.calls.push({name,event:'start',at:performance.now()});p.active[name]=(p.active[name]||0)+1;p.max[name]=Math.max(p.max[name]||0,p.active[name]);await new Promise(r=>setTimeout(r,100));p.active[name]--;p.calls.push({name,event:'end',at:performance.now()});return value();}
export const supabase={
 auth:{
  async getSession(){return {data:{session},error:null};},
  getUser:()=>read('getUser',()=>({data:{user:session.user},error:null})),
  onAuthStateChange(callback){queueMicrotask(()=>callback('INITIAL_SESSION',session));return {data:{subscription:{unsubscribe(){}}}};}
 },
 schema:()=>({rpc:name=>read(name,()=>({data:name==='v1_me'?{id:'1',auth_id:'synthetic-auth',role:3,version:window.version,capabilities:{},write_state:{mode:'mirror',allowed:false}}:{api_version:1,update_required:false},error:null}))})
};`;
const modules={
 '../supabaseClient':transport,
 '../runtimeEnv':`export const getRuntimeEnv=()=>({env:'staging'});`,
 '../App':`export default function Stub(){return null;}`,
 '../squad/SquadApp':`import React,{useEffect}from'react';export default function Stub(){useEffect(()=>{window.probe.mounts++;},[]);return React.createElement('div',{'data-squad-probe':true},'ready');}`,
 './AccountFlow':`export default function Stub(){return null;}`,
 '../components/auth/LoginPage':`export default function Stub(){return null;}`,
 '../components/ui/button':`import React from'react';export const Button=props=>React.createElement('button',props);`,
 './WorkspaceErrorBoundary':`export default function Stub({children}){return children;}`,
};
await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import AppRoot from'${root}/apps/admin/src/application/AppRoot.jsx';createRoot(document.getElementById('root')).render(<AppRoot/>);`,resolveDir:root,loader:'jsx'},outfile:path.join(scratch,'app.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',alias:{react:path.join(root,'node_modules/react'),'react-dom':path.join(root,'node_modules/react-dom')},define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'local-boundaries',setup(b){b.onResolve({filter:/.*/},args=>Object.hasOwn(modules,args.path)?{path:args.path,namespace:'probe'}:undefined);b.onLoad({filter:/.*/,namespace:'probe'},args=>({contents:modules[args.path],loader:'js',resolveDir:root}));}}],logLevel:'silent'});
await fs.writeFile(path.join(scratch,'index.html'),'<html><body><div id="root"></div><script src="app.js"></script></body></html>');
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();page.on('pageerror',e=>console.error(e.message));await page.setRequestInterception(true);page.on('request',async r=>{const u=new URL(r.url());if(u.origin!=='http://session-probe.invalid'){await r.abort();return;}const js=u.pathname.endsWith('/app.js');await r.respond({status:200,contentType:js?'text/javascript':'text/html',body:await fs.readFile(path.join(scratch,js?'app.js':'index.html'))});});
 await page.goto('http://session-probe.invalid/squad/home');await page.waitForSelector('[data-squad-probe]');
 await page.waitForFunction(()=>Object.values(window.probe.active).every(n=>n===0));
 const snapshot=()=>page.evaluate(()=>({starts:Object.fromEntries(['getUser','v1_me','v1_app_bootstrap'].map(name=>[name,window.probe.calls.filter(c=>c.name===name&&c.event==='start').length])),max:window.probe.max,mounts:window.probe.mounts}));
 const initial=await snapshot();
 await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForFunction(count=>window.probe.calls.filter(c=>c.name==='v1_me'&&c.event==='end').length>=count+1,{},initial.starts.v1_me);
 const foreground=await snapshot();assert.equal(foreground.starts.v1_me-initial.starts.v1_me,1);assert.equal(foreground.mounts,initial.mounts);
 await page.evaluate(()=>{window.version='1:2';window.dispatchEvent(new Event('focus'));});
 await page.waitForFunction(count=>window.probe.mounts===count+1,{},foreground.mounts);
 const changedScope=await snapshot();
 const report={scope:'Actual AppRoot with synthetic delayed Auth/RPC and inert routed view; no hosted requests. Counts demonstrate launch behavior, not attribution of hosted SQL timeouts.',initial,foreground,changedScope};
 await fs.writeFile('/tmp/squad-session-query-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await fs.rm(scratch,{recursive:true,force:true});}
