import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {rpc} from './web-reporting-hosted-journey.mjs';

test('reporting action failure survives the real browser-close rejection of its orphan waiter',async()=>{
 const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage(),original=new Error('Required report control absent');
 try{await assert.rejects(rpc(page,'v1_sales_report',async()=>{throw original;}),error=>error===original);}
 finally{await browser.close();}
 await new Promise(resolve=>setImmediate(resolve));
});
test('report response failure is still rejected when action succeeds',async()=>{
 const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage();
 try{await assert.rejects(rpc(page,'v1_sales_report',()=>page.close()));}
 finally{await browser.close();}
});
