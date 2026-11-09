/** Anonymous frozen-entry startup check. All remote traffic is blocked. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import puppeteer from 'puppeteer';
import {approvedFrontend} from './web-tracker-read-policy.mjs';
import {browserErrorDiagnostic} from './browser-error-diagnostic.mjs';

export async function startupPreflight(base) {
 assert(approvedFrontend(base));const origin=new URL(base).origin;
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const errors=[];let externalRequestsBlocked=0;
 try {
  const page=await browser.newPage();await page.evaluateOnNewDocument(()=>localStorage.setItem('scott-dashboard-env-override','staging'));
  await page.setRequestInterception(true);page.on('request',r=>{if(new URL(r.url()).origin===origin&&['GET','HEAD'].includes(r.method()))void r.continue();else {externalRequestsBlocked++;void r.abort();}});
  let fail;const crashed=new Promise(resolve=>{fail=resolve;});
  page.on('pageerror',error=>{errors.push(browserErrorDiagnostic(error));fail(false);});
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});
  const ready=await Promise.race([page.waitForSelector('#login-email',{visible:true,timeout:15000}).then(()=>true).catch(()=>false),crashed]);
  const valid=ready&&await page.$eval('#login-password',n=>n.type==='password').catch(()=>false);
  return {ready:Boolean(valid&&errors.length===0),errors,externalRequestsBlocked,scope:'Anonymous startup only; external traffic blocked; no credentials or hosted calls'};
 } finally {await browser.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try {const result=await startupPreflight(process.argv[2]);console.log(JSON.stringify(result));process.exitCode=result.ready?0:1;}
 catch(error){console.log(JSON.stringify({ready:false,errors:[browserErrorDiagnostic(error)]}));process.exitCode=1;}
}
