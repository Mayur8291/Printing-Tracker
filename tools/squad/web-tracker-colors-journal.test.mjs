/** Execute the production request callback and fsynced journal with native CORS. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import puppeteer from 'puppeteer';
import {journalColorsMutation} from './web-tracker-colors-hosted.mjs';import {colorsDecision} from './web-tracker-colors-policy.mjs';import {STAGING} from './web-tracker-read-policy.mjs';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
test('production mutation callback journals all3 phases before sending; out-of-order and foreign writes cannot send',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'colors-journal-'));fs.chmodSync(folder,0o700);const journal=path.join(folder,'requests.json');
 const entries=[],receipts=[],refusals=[];const scope={name:'UI Colors native journal',editedName:'UI Colors native journal edited',id:'42',updatedAt:'2026-11-09T00:00:00',phase:'update'};
 const frontend=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Local journal boundary</title>');});const base=await listen(frontend);
 const backend=http.createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin',base);res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,content-profile');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}let body='';req.on('data',part=>body+=part);req.on('end',()=>{const payload=JSON.parse(body),phase=payload.p_action??payload.action;receipts.push({phase,request:payload,journal:JSON.parse(fs.readFileSync(journal,'utf8')),mode:fs.statSync(journal).mode&0o777});res.setHeader('Content-Type','application/json');res.end('{"id":42}');});});const back=await listen(backend);
 const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',request=>{
   const url=new URL(request.url());if(url.origin===base){void request.continue();return;}if(url.origin!==back){void request.abort();return;}
   const decision=colorsDecision({url:STAGING+url.pathname,method:request.method(),headers:request.headers(),body:request.postData()},base+'/',scope);
   if(decision==='preflight'){void request.continue();return;}
   if(decision!=='mutation'){refusals.push('policy');void request.abort();return;}
   try{void journalColorsMutation(request,scope,entries,journal);}catch{refusals.push('sequence');void request.abort();}
  });await page.goto(base);
  const payload=phase=>phase==='delete'?{resource:'colors',action:'delete',payload:{id:scope.id}}:{p_resource:'colors',p_action:phase,p_payload:{...(phase==='update'?{id:scope.id,expectedUpdatedAt:scope.updatedAt}:{}),values:{name:phase==='create'?scope.name:scope.editedName,hex_code:phase==='create'?'#2457AA':'#196B45',is_deleted:'false'},relations:{}},p_upload_ids:[],p_idempotency_key:'ad7efb91-2b17-49c4-b61d-90a28399f12d'};
  const send=body=>page.evaluate(async({url,body})=>{try{const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer synthetic',apikey:'synthetic','Content-Type':'application/json','Content-Profile':'canto_api'},body:JSON.stringify(body)});return {status:response.status};}catch{return {failed:true};}},{url:back+'/rest/v1/rpc/'+(body.action==='delete'?'masters':'account_master_save'),body});
  assert.deepEqual(await send(payload('update')),{failed:true});assert.equal(entries.length,0);assert.equal(fs.existsSync(journal),false);assert.equal(receipts.length,0);
  for(const phase of ['create','update','delete']){scope.phase=phase;assert.deepEqual(await send(payload(phase)),{status:200});}
  assert.deepEqual(receipts.map(x=>x.phase),['create','update','delete']);
  for(const [i,receipt] of receipts.entries()){assert.equal(receipt.journal.length,i+1);assert.equal(receipt.mode,0o600);assert.equal(receipt.journal[i].action,receipt.phase);assert.deepEqual(receipt.journal[i].body,receipt.request);}
  const saved=fs.readFileSync(journal,'utf8');scope.phase='update';assert.deepEqual(await send(payload('update')),{failed:true});assert.equal(fs.readFileSync(journal,'utf8'),saved);assert.equal(entries.length,3);assert.equal(receipts.length,3);
  const foreign=payload('update');foreign.p_payload.values.name='not owned';assert.deepEqual(await send(foreign),{failed:true});assert.equal(fs.readFileSync(journal,'utf8'),saved);assert.equal(receipts.length,3);assert.deepEqual(refusals,['sequence','sequence','policy']);
 }finally{await browser.close();await Promise.all([new Promise(resolve=>frontend.close(resolve)),new Promise(resolve=>backend.close(resolve))]);fs.rmSync(folder,{recursive:true});}
});
