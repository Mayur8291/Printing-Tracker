// Exercise the failure report without modifying a remote job or source file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
const state=JSON.parse(fs.readFileSync('tools/canto-sync/private/browser-state.json'));
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluateOnNewDocument(state=>{
  for(const[k,v]of Object.entries(state.local))localStorage.setItem(k,v);
  const original=window.fetch;
  window.fetch=async(...args)=>{
   const response=await original(...args);
   if(String(args[0]).includes('/functions/v1/canto-refresh')&&args[1]?.body?.includes('"action":"status"')&&response.ok){
    const data=await response.clone().json();data.jobs.unshift({id:'browser-only-failed-media',status:'failed',stage:'failed',created_at:new Date().toISOString(),message:'Refresh stopped before publication.',summary:{media:{copied:0,unchanged:0,missing:0,external:0,failed:1,failure_samples:[{resource:'catalogues',record_id:1,field:'url',http_status:503,error_type:'HTTPError'}]}}});
    return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});
   }
   return response;
  };
 },state);
 await page.goto('http://127.0.0.1:5173',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.innerText==='Data Refresh'),{timeout:60000});
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText==='Data Refresh').click());
 await page.waitForFunction(()=>document.body.innerText.includes('catalogues #1 · url · HTTP 503'),{timeout:60000});
 assert(await page.evaluate(()=>document.body.innerText.includes('1 failed')));assert.deepEqual(errors,[]);
 console.log(JSON.stringify({failedFileIdentifiersVisible:true,rawSecretsNotInjected:true,remoteChanges:0,browserErrors:0}));
}finally{await browser.close();}
