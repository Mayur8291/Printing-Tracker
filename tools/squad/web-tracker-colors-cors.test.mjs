/** Native two-origin browser CORS; every network request stays on loopback. */
import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import puppeteer from 'puppeteer';
import {colorsDecision} from './web-tracker-colors-policy.mjs';import {STAGING} from './web-tracker-read-policy.mjs';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
test('native cross-origin preflight precedes exact Colors POST; foreign payload stays blocked',async()=>{
 const received=[],decisions=[];let base,scope={phase:'create',name:'UI Colors cors',editedName:'UI Colors cors edited',id:null,updatedAt:null};
 const front=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>local CORS boundary</title>');});base=await listen(front);
 const back=http.createServer((req,res)=>{received.push(req.method);res.setHeader('Access-Control-Allow-Origin',base);res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','apikey,authorization,content-profile,content-type,x-client-info');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}let text='';req.on('data',c=>text+=c);req.on('end',()=>{const body=JSON.parse(text);assert.equal(body.p_resource,'colors');res.setHeader('Content-Type','application/json');res.end('{"id":42}');});});const backend=await listen(back);
 const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',req=>{const u=new URL(req.url());if(u.origin===base){void req.continue();return;}if(u.origin!==backend){void req.abort();return;}
   const decision=colorsDecision({url:STAGING+u.pathname+u.search,method:req.method(),headers:req.headers(),body:req.postData()},base+'/',scope);decisions.push({method:req.method(),decision,bodyPresent:!!req.postData(),profile:req.headers()['content-profile']??null});if(['mutation','preflight'].includes(decision))void req.continue();else void req.abort();
  });await page.goto(base);
  const body={p_resource:'colors',p_action:'create',p_payload:{values:{name:scope.name,hex_code:'#2457AA',is_deleted:'false'},relations:{}},p_upload_ids:[],p_idempotency_key:'ad7efb91-2b17-49c4-b61d-90a28399f12d'};
  const send=payload=>page.evaluate(async({url,body})=>{try{const r=await fetch(url,{method:'POST',headers:{apikey:'synthetic',Authorization:'Bearer synthetic','Content-Profile':'canto_api','Content-Type':'application/json','X-Client-Info':'synthetic-cors'},body:JSON.stringify(body)});return {status:r.status,json:await r.json()};}catch{return {failed:true};}},{url:backend+'/rest/v1/rpc/account_master_save',body:payload});
  assert.deepEqual(await send(body),{status:200,json:{id:42}},JSON.stringify(decisions));assert.deepEqual(received,['OPTIONS','POST']);assert.deepEqual(decisions.map(x=>x.decision),['preflight','mutation']);
  const foreign=structuredClone(body);foreign.p_payload.values.name='foreign';assert.deepEqual(await send(foreign),{failed:true});assert.deepEqual(received,['OPTIONS','POST']);assert.equal(decisions.at(-1).decision,'deny');
 }finally{await browser.close();await Promise.all([new Promise(r=>front.close(r)),new Promise(r=>back.close(r))]);}
});
