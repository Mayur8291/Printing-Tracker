import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFrontendBinding} from './web-cross-browser-hosted.mjs';
const base='http://127.0.0.1:5186',frontend={base,entry_path:'/assets/index-local.js',entry_sha256:'a'.repeat(64)};
test('clean static origin and default dev origin retain exact entry binding',()=>{
 assert.equal(validateFrontendBinding(frontend,base),base);
 assert.equal(validateFrontendBinding({base:'http://localhost:5183',entry_path:'/src/main.jsx',entry_sha256:'b'.repeat(64)},'http://localhost:5183'),'http://localhost:5183');
});
test('child refuses changed origin, untrusted entry, credentials, query and malformed digest',()=>{
 for(const value of [{...frontend,base:'http://localhost:5183'},{...frontend,entry_path:'https://outside.invalid/a.js'},{...frontend,entry_path:'/assets/../index.js'},{...frontend,entry_sha256:'bad'}])assert.throws(()=>validateFrontendBinding(value,base));
 for(const origin of ['https://localhost:5186','http://localhost:5186/a','http://x:y@localhost:5186','http://outside.invalid:5186','http://localhost:5186?x=1','http://localhost:5186#x','http://localhost'])assert.throws(()=>validateFrontendBinding(null,origin));
});

const cloud='https://scottdashboard.vercel.app';
const release={format:'squad-reviewed-deployed-frontend/v1',base:cloud,entry_path:'/assets/index-release.js',entry_sha256:'c'.repeat(64),git_commit:'d'.repeat(40),deployment_id:'dpl_Reviewed123456'};
const cloudEntry={base:cloud,entry_path:release.entry_path,entry_sha256:release.entry_sha256};
test('cloud requires explicit exact reviewed release and same entry receipt',()=>{
 assert.equal(validateFrontendBinding(cloudEntry,cloud,release),cloud);
 assert.throws(()=>validateFrontendBinding(cloudEntry,cloud));
 for(const change of [{git_commit:'short'},{deployment_id:'unknown'},{entry_sha256:'e'.repeat(64)},{entry_path:'/src/main.jsx'},{base:'https://outside.vercel.app'},{extra:'denied'}])assert.throws(()=>validateFrontendBinding(cloudEntry,cloud,{...release,...change}));
});
test('explicit staging override runs before application modules without credentials or production access',async()=>{
 const {stagingFrontendInit}=await import('./web-cross-browser-hosted.mjs');
 const {runInNewContext}=await import('node:vm');const writes=[];
 runInNewContext(`(${stagingFrontendInit.toString()})()`,{localStorage:{setItem:(...args)=>writes.push(args)}});
 assert.deepEqual(writes,[['scott-dashboard-env-override','staging']]);
 const {transportAllowed}=await import('./web-cross-browser-policy.mjs');
 assert.equal(transportAllowed({url:cloud+'/assets/index-release.js',method:'GET'},cloud),true);
 assert.equal(transportAllowed({url:cloud+'/api/write',method:'POST',body:'{}'},cloud),false);
 assert.equal(transportAllowed({url:'https://outside.supabase.co/rest/v1/rpc/v1_me',method:'POST',body:'{}'},cloud),false);
 assert.equal(transportAllowed({url:'https://scvojtvgnkmbupvyslmb.supabase.co/rest/v1/rpc/v1_task_save',method:'POST',body:'{}'},cloud),false);
});
