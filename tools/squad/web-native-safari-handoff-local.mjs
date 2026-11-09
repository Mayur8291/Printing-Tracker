/** Synthetic local handoff page only; no hosted credentials or system clipboard. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const processChild=spawn('../Canto/canto-sync/.venv/bin/python',['-u','-c',"import sys;sys.path.insert(0,'tools/squad');from native_safari_handoff import handoff;handoff({'email':'synthetic@example.invalid','password':'synthetic-password'},60)"],{stdio:['ignore','pipe','pipe']});
let browser;
try {
 const info=await new Promise((resolve,reject)=>{let data='';const timer=setTimeout(()=>reject(Error('Local handoff did not start')),5000);processChild.stdout.on('data',chunk=>{data+=chunk;const line=data.split('\n')[0];try{const parsed=JSON.parse(line);clearTimeout(timer);resolve(parsed);}catch{}});processChild.once('exit',code=>{clearTimeout(timer);reject(Error(`Local handoff exited ${code}`));});});
 browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluateOnNewDocument(()=>{window.clipboardWrites=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>window.clipboardWrites.push(value)}});});
 await page.setViewport({width:360,height:844});await page.goto(info.native_safari_handoff_url,{waitUntil:'domcontentloaded'});
 const body=await page.$eval('body',n=>n.innerText);assert(!body.includes('synthetic@example.invalid'));assert(!body.includes('synthetic-password'));
 assert(body.includes('Native Safari has no request-blocking interceptor.'));assert(body.includes('Do not save or submit business forms'));
 assert(await page.$eval('#finish',n=>n.disabled));await page.click('#email');await page.click('#password');
 assert.deepEqual(await page.evaluate(()=>window.clipboardWrites),['synthetic@example.invalid','synthetic-password']);
 await page.click('#out');assert(await page.$eval('#finish',n=>n.disabled));await page.click('#closed');assert.equal(await page.$eval('#finish',n=>n.disabled),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 await page.screenshot({path:'/tmp/squad-native-safari-handoff-local-360.png'});
 await page.click('#finish');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Shutdown acknowledged'));
 assert.deepEqual(await page.evaluate(()=>window.clipboardWrites),['synthetic@example.invalid','synthetic-password','']);
 assert(await page.$eval('#email',n=>n.disabled));assert(await page.$eval('#password',n=>n.disabled));assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks:['credentials_not_visible','direct_copy_controls','both_shutdown_confirmations_required','clipboard_clear_before_ack','copy_disabled_after_finish','360px_no_overflow','csp_script_executes_without_errors'],scope:'Synthetic local Chrome rendering; no native Safari or hosted acceptance'}));
} finally {if(browser)await browser.close();processChild.kill('SIGTERM');}
