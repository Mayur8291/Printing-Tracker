import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {rpc} from './web-collaboration-hosted-journey.mjs';
import {response} from './web-operations-read-hosted-journey.mjs';
import {rebuildResponse} from './web-stock-reconciliation-hosted-journey.mjs';
import {rpc as catalogueRpc,reservationResponse} from './web-catalogue-media-hosted-journey.mjs';
import {response as operationsResponse} from './web-operations-hosted-journey.mjs';
const cases=[['collaboration',(p,a)=>rpc(p,'v1_task_save',a)],['operations-read',(p,a)=>response(p,'v1_job_get',a)],['operations-write',(p,a)=>operationsResponse(p,'v1_worker_due_save',a)],['stock',rebuildResponse],['catalogue-rpc',(p,a)=>catalogueRpc(p,'v1_product_configure',a)],['catalogue-reservation',async(p,a)=>{const wait=reservationResponse(p);await a();return wait;}]];
for(const[name,invoke]of cases){
 test(`${name}: original action failure survives browser-close orphan rejection`,async()=>{
  const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage(),original=new Error('Original local control failure');
  try{await assert.rejects(invoke(page,async()=>{throw original;}),error=>error===original);}finally{await browser.close();}
  await new Promise(resolve=>setImmediate(resolve));
 });
 test(`${name}: failed response remains rejected after a successful action`,async()=>{
  const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage();try{await assert.rejects(invoke(page,()=>page.close()));}finally{await browser.close();}
 });
}
