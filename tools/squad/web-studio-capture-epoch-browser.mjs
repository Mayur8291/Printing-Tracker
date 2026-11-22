/** Capture the actual mounted React preview, pause PNG conversion, then change its view/lifecycle. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-webgl','--ignore-gpu-blocklist']});
const checks=[];
try{
 const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
 await page.goto((process.env.STUDIO_PREVIEW_BASE??'http://127.0.0.1:5198')+'/studio-preview');
 await page.waitForFunction(()=>document.querySelector('[data-preview-state="supported"]')&&document.querySelector('.squad-studio-preview')&&!document.querySelector('.squad-studio-preview [role="status"]'),{timeout:45000});
 await page.evaluate(()=>{
  const original=window.fetch;window.__captureQueue=[];window.__captureResults={};
  window.fetch=(...args)=>String(args[0]).startsWith('data:image/png')?new Promise((resolve,reject)=>window.__captureQueue.push(()=>original(...args).then(resolve,reject))):original(...args);
  window.__beginCapture=id=>{window.__captureResults[id]={status:'pending'};document.querySelector('.squad-studio-preview').captureStudioPreview().then(file=>{window.__captureResults[id]={status:'resolved',type:file.type,bytes:file.size};},error=>{window.__captureResults[id]={status:'rejected',message:error.message};});};
 });
 await page.evaluate(()=>window.__beginCapture('old'));
 await page.waitForFunction(()=>window.__captureQueue.length===1);
 await page.evaluate(()=>[...document.querySelectorAll('.studio-camera-toolbar button')].find(button=>button.textContent.trim().toLowerCase()==='back').click());
 await page.waitForFunction(()=>window.__captureResults.old.status==='rejected');checks.push('Camera interaction rejects capture while PNG conversion is paused');
 await page.evaluate(()=>window.__beginCapture('new'));
 await page.waitForFunction(()=>window.__captureQueue.length===2);
 await page.evaluate(()=>window.__captureQueue[0]());
 await page.waitForFunction(()=>window.__captureResults.old.status==='rejected');
 assert.equal(await page.evaluate(()=>window.__captureResults.new.status),'pending');
 await page.evaluate(()=>window.__captureQueue[1]());
 await page.waitForFunction(()=>window.__captureResults.new.status==='resolved');
 assert.equal(await page.evaluate(()=>window.__captureResults.new.type),'image/png');checks.push('Late obsolete conversion cannot clear the newer capture ticket');
 await page.evaluate(()=>window.__beginCapture('loss'));
 await page.waitForFunction(()=>window.__captureQueue.length===3);
 await page.evaluate(()=>{window.__glLoss=document.querySelector('.squad-studio-preview canvas').getContext('webgl2').getExtension('WEBGL_lose_context');if(!window.__glLoss)throw Error('Test browser must support WebGL context loss');window.__glLoss.loseContext();});
 await page.waitForFunction(()=>window.__captureResults.loss.status==='rejected');
 await page.evaluate(()=>window.__captureQueue[2]());
 assert.equal(await page.evaluate(()=>window.__captureResults.loss.status),'rejected');checks.push('Context loss rejects detached PNG conversion immediately');
 const report={status:'passed',checks,results:await page.evaluate(()=>window.__captureResults),scope:'Actual React web preview with isolated local catalogue; no production writes'};
 await fs.mkdir('output/web-studio-capture-epoch',{recursive:true});await fs.writeFile('output/web-studio-capture-epoch/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
