// Real staging session, read-only media/browser acceptance. Run after media backfill.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
const state = JSON.parse(fs.readFileSync('tools/canto-sync/private/browser-state.json'));
const browser = await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 const page=await browser.newPage();const errors=[],legacy=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:1000});
 await page.setRequestInterception(true);
 page.on('request',r=>{
  if (/64\.227\.186\.227|165\.22\.210\.53|leaderboard\.sagarfab\.com/.test(r.url())) {legacy.push(r.url());r.abort();} else r.continue();
 });
 await page.evaluateOnNewDocument(s=>{for(const[k,v]of Object.entries(s.local))localStorage.setItem(k,v);localStorage.setItem('canto:admin-target:v1',JSON.stringify({source:'supabase',environment:'staging'}));localStorage.setItem('scott-dashboard-env-override','staging');},state);
 await page.goto('http://127.0.0.1:5173');
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.innerText==='Masters'),{timeout:60000});
 const results=await page.evaluate(async()=>{
  const{cantoRpc,getCantoClient}=await import('/src/canto/target.js');
  const{getEnvironmentConfig}=await import('/src/runtimeEnv.js');
  const{createClient}=await import('/node_modules/.vite/deps/@supabase_supabase-js.js');
  const client=getCantoClient();const results=[];
  const status=await cantoRpc('media_status',{});if(status.summary.pending)throw Error('Backfill is still pending');
  const rows=(await cantoRpc('masters',{resource:'rmp_categories',action:'list',payload:{items:100}})).data;
  const image=rows.find(r=>r.image?.includes('/storage/v1/object/sign/canto-media/'))?.image;
  if(!image)throw Error('No migrated category image');
  await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>img.naturalWidth>0?resolve():reject(Error('Empty image'));img.onerror=()=>reject(Error('Image decoding failed'));img.src=image;});
  results.push('real migrated image decodes in browser with legacy requests blocked');
  const path=new URL(image).pathname.split('/canto-media/')[1];
  const publicResponse=await fetch(getEnvironmentConfig('staging').url+'/storage/v1/object/public/canto-media/'+path);
  if(publicResponse.ok)throw Error('Private object publicly accessible');
  const {url,anonKey}=getEnvironmentConfig('staging');const anon=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const denied=await anon.storage.from('canto-media').createSignedUrl(path,60);if(!denied.error)throw Error('Anonymous signing allowed');
  results.push('anonymous/public access denied, real administrator signing allowed');
  const exceptions=await cantoRpc('media_exceptions',{page_number:1});
  if(status.summary.missing&&!exceptions.some(r=>r.status==='missing'))throw Error('Missing files hidden');
  results.push('missing source files explicitly reported');
  return {results,summary:status.summary};
 });
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText==='Masters').click());
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.innerText==='RMP Categories'));
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText==='RMP Categories').click());
 await page.waitForFunction(()=>[...document.querySelectorAll('img')].some(i=>i.src.includes('/canto-media/')&&i.complete&&i.naturalWidth>0),{timeout:60000});
 await page.screenshot({path:'/tmp/canto-media-staging-masters.png',fullPage:true});
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText==='Data Refresh').click());
 await page.waitForFunction(()=>document.body.innerText.includes('Media needs attention'),{timeout:60000});
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText==='View exceptions (first 100)').click());
 await page.waitForFunction(()=>document.body.innerText.includes('Missing on old server'));
 await page.screenshot({path:'/tmp/canto-media-staging-report.png',fullPage:true});
 assert.equal(legacy.length,0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({...results,legacyRequests:0,browserErrors:0},null,2));
}finally{await browser.close();}
