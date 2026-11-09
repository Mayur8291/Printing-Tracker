import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {rpc} from './web-workflow-extensions-hosted-journey.mjs';

test('real failed action keeps its error after browser close rejects orphan response waiter',async()=>{
 const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage(),original=new Error('Required field absent');
 try{await assert.rejects(rpc(page,'v1_task_save',async()=>{throw original;}),error=>error===original);}
 finally{await browser.close();}
 // An unhandled TargetCloseError fails this node:test after the real close.
 await new Promise(resolve=>setImmediate(resolve));
});
test('response waiter rejection remains a rejection when action itself succeeds',async()=>{
 const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage();
 try{await assert.rejects(rpc(page,'v1_task_save',()=>page.close()));}
 finally{await browser.close();}
});
