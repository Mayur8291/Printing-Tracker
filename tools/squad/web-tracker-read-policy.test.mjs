import test from 'node:test';
import assert from 'node:assert/strict';
import {STAGING, approvedFrontend, trackerReadDecision as check} from './web-tracker-read-policy.mjs';
const base='http://127.0.0.1:5183';
const rpc=(name,payload,extra={})=>({url:STAGING+'/rest/v1/rpc/'+name,method:'POST',body:JSON.stringify(payload),headers:{'content-profile':'canto_api'},...extra});
test('exact staging and approved frontend origins; arbitrary hosts never forward',()=>{
 assert.equal(approvedFrontend('https://scottdashboard.vercel.app'),true);
 for(const x of ['https://scottdashboard.vercel.app.evil.invalid','https://user:pass@scottdashboard.vercel.app','https://scottdashboard.vercel.app/?x=1'])assert.equal(approvedFrontend(x),false);
 for(const url of ['https://levwrmvqdntngeasrtnb.supabase.co/rest/v1/profiles','http://64.227.186.227/uploads/x.png','wss://scvojtvgnkmbupvyslmb.supabase.co/realtime/v1/websocket'])assert.equal(check({url,method:'GET'},base),'deny');
 assert.equal(check({url:base+'/assets/index.js',method:'GET'},base),'local');
});
test('real profile read allowed, profile mutation and schema/RPC GET bypass denied',()=>{
 assert.equal(check({url:STAGING+'/rest/v1/profiles?id=eq.fixture',method:'GET'},base),'read');
 for(const method of ['POST','PATCH','DELETE'])assert.equal(check({url:STAGING+'/rest/v1/profiles',method,body:'{}'},base),'deny');
 assert.equal(check({url:STAGING+'/rest/v1/profiles',method:'GET',headers:{'accept-profile':'sa_snapshot_20261019'}},base),'deny');
 assert.equal(check({...rpc('promote_stale_new_orders_to_pending',{}),method:'GET'},base),'deny');
});
test('automatic writes distinguished but never allowed; dashboard command variants denied',()=>{
 for(const name of ['set_my_dashboard_presence','promote_stale_new_orders_to_pending'])assert.equal(check(rpc(name,{}),base),'blocked-automatic-write');
 for(const action of ['query','capabilities','customer_options','export_read'])assert.equal(check(rpc('dashboard',{p_action:action}),base),'read');
 for(const action of ['customer_save','customer_archive','export_start','unknown'])assert.equal(check(rpc('dashboard',{p_action:action}),base),'deny');
 assert.equal(check(rpc('dashboard',{p_action:'query'},{headers:{'content-profile':'public'}}),base),'deny');
 assert.equal(check(rpc('dashboard',{}, {body:'{bad json'}),base),'deny');
});
test('only exact Masters resource reads and refresh status can forward',()=>{
 assert.equal(check(rpc('masters',{resource:'authorized_brands',action:'list'}),base),'read');
 assert.equal(check(rpc('masters',{resource:'authorized_brands',action:'create'}),base),'deny');
 assert.equal(check(rpc('masters',{resource:'rmp_products',action:'list'}),base),'deny');
 const req={url:STAGING+'/functions/v1/canto-refresh',method:'POST'};
 assert.equal(check({...req,body:JSON.stringify({action:'status',environment:'staging'})},base),'read');
 for(const p of [{action:'start',environment:'staging'},{action:'status',environment:'production'},{action:'status',environment:'staging',discard_revision:1}])assert.equal(check({...req,body:JSON.stringify(p)},base),'deny');
});
test('existing media grant bounded; uploads and other buckets denied',()=>{
 const req={url:STAGING+'/storage/v1/object/sign/canto-media',method:'POST'};
 assert.equal(check({...req,body:JSON.stringify({paths:['staging/a.png'],expiresIn:3600})},base),'read');
 for(const payload of [{paths:['../a'],expiresIn:30},{paths:['a'],expiresIn:3601},{paths:Array(101).fill('a'),expiresIn:30}])assert.equal(check({...req,body:JSON.stringify(payload)},base),'deny');
 assert.equal(check({...req,url:STAGING+'/storage/v1/object/canto-media/a',body:'{}'},base),'deny');
 assert.equal(check({...req,url:STAGING+'/storage/v1/object/sign/other',body:JSON.stringify({paths:['a'],expiresIn:30})},base),'deny');
});
test('source-reviewed startup reads allow exact selects only, never wider reads or writes',()=>{
 const cases=[['support_admins',{select:'user_id'}],['sample_job_sheet_settings',{select:'default_sla_days,default_sla_hours,warn_hours,urgent_hours',id:'eq.1'}],['inventory_skus',{select:'id,sku_code,kind,name,color,hex_color,stock_qty,reorder_point,unit,unit_cost,supplier_id,warehouse_id,extra',order:'name.asc,sku_code.asc',offset:'0',limit:'1000'}]];
 for(const [table,params] of cases){
  const url=STAGING+'/rest/v1/'+table+'?'+new URLSearchParams(params);
  for(const method of ['GET','HEAD'])assert.equal(check({url,method},base),'read');
  for(const method of ['POST','PATCH','DELETE','PUT'])assert.equal(check({url,method,body:'{}'},base),'deny');
  assert.equal(check({url,method:'GET',headers:{'accept-profile':'sa_snapshot_20261019'}},base),'deny');
  for(const extra of [{select:'*'},{select:'user_id,profiles(*)'},{or:'(id.gt.0)'},{unknown:'1'}])assert.equal(check({url:STAGING+'/rest/v1/'+table+'?'+new URLSearchParams({...params,...extra}),method:'GET'},base),'deny');
  assert.equal(check({url:url+'&select=*',method:'GET'},base),'deny');
 }
 const sku=cases[2][1];
 for(const extra of [{limit:'1001'},{offset:'1'},{offset:'-1000'},{offset:'9007199254741000'},{order:'id.asc'}])assert.equal(check({url:STAGING+'/rest/v1/inventory_skus?'+new URLSearchParams({...sku,...extra}),method:'GET'},base),'deny');
 assert.equal(check({url:STAGING+'/rest/v1/inventory_skus?'+new URLSearchParams({...sku,offset:'1000'}),method:'GET'},base),'read');
 assert.equal(check({url:STAGING+'/rest/v1/sample_job_sheet_settings?'+new URLSearchParams({...cases[1][1],id:'gte.1'}),method:'GET'},base),'deny');
});
