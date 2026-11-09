import test from 'node:test';
import assert from 'node:assert/strict';
import {transportAllowed as allow,STAGING_ORIGIN as origin} from './web-cross-browser-policy.mjs';
const request=(pathname,method='POST',body)=>({url:origin+pathname,method,body:JSON.stringify(body)});
test('only explicit staging reads are admitted',()=>{
 for(const rpc of ['v1_me','v1_app_bootstrap','v1_orders_list','v1_person_get','v1_tailor_work'])assert.equal(allow(request('/rest/v1/rpc/'+rpc)),true);
 for(const rpc of ['v1_order_place','v1_account_close','v1_profile_save','v1_product_image_comment','v1_unknown_read'])assert.equal(allow(request('/rest/v1/rpc/'+rpc)),false);
 assert.equal(allow(request('/rest/v1/sa_users','GET')),false);
 assert.equal(allow({url:'https://levwrmvqdntngeasrtnb.supabase.co/rest/v1/rpc/v1_me',method:'POST'}),false);
});
test('dual purpose stock RPC is read-action constrained',()=>{
 for(const action of ['review','history'])assert.equal(allow(request('/rest/v1/rpc/v1_stock_reconciliation','POST',{p_action:action})),true);
 for(const action of ['rebuild',null,undefined])assert.equal(allow(request('/rest/v1/rpc/v1_stock_reconciliation','POST',{p_action:action})),false);
 assert.equal(allow({...request('/rest/v1/rpc/v1_stock_reconciliation'),body:'invalid'}),false);
});
test('provider, upload, account mutation and external links cannot execute',()=>{
 for(const suffix of ['media/uploads','media/verify','media/finalize','register','recovery','users/status','users/invite','documents/download'])assert.equal(allow(request('/functions/v1/squad-account/'+suffix)),false);
 assert.equal(allow(request('/functions/v1/squad-account/media/grants')),true);
 assert.equal(allow(request('/storage/v1/object/sign/bucket/object','GET')),true);
 assert.equal(allow(request('/storage/v1/object/sign/bucket/object','PUT')),false);
 assert.equal(allow({url:'https://wa.me/123',method:'GET'}),false);
});
test('only local assets and fixture login lifecycle are admitted',()=>{
 assert.equal(allow({url:'http://localhost:5183/squad/home',method:'GET'}),true);
 assert.equal(allow({url:'http://localhost:5184/squad/home',method:'GET'}),false);
 assert.equal(allow({url:'http://localhost:5183/action',method:'POST'}),false);
 assert.equal(allow(request('/auth/v1/token?grant_type=password')),true);
 assert.equal(allow(request('/auth/v1/token?grant_type=refresh_token')),true);
 assert.equal(allow(request('/auth/v1/signup')),false);
 assert.equal(allow(request('/auth/v1/user','PUT')),false);
});
