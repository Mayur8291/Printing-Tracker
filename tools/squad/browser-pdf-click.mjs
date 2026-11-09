/** Acceptance evidence for a real PDF anchor click, whether Chrome downloads or
 * opens its native viewer. Only harness-owned browser contexts may use this.
 * No provider credentials, URL tokens or attachment paths enter the result. */
import assert from 'node:assert/strict';
import {mkdtemp,chmod,readFile,lstat,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
const MAX_BYTES=8*1024*1024;
function verify(bytes,expected){assert.equal(bytes.length,Number(expected.bytes),'Clicked PDF byte length mismatch');assert.equal(bytes.subarray(0,5).toString(),'%PDF-','Clicked resource is not a PDF');const sha256=createHash('sha256').update(bytes).digest('hex');assert.equal(sha256,expected.sha256,'Clicked PDF SHA256 mismatch');return{bytes:bytes.length,sha256};}
async function viewerBytes(page,url){return page.evaluate(async url=>{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);try{const response=await fetch(url,{credentials:'omit',redirect:'error',signal:controller.signal});if(!response.ok||!response.headers.get('content-type')?.startsWith('application/pdf'))throw Error('Viewer PDF response unavailable');const reader=response.body.getReader(),chunks=[];let length=0;for(;;){const{done,value}=await reader.read();if(done)break;length+=value.length;if(length>8*1024*1024){await reader.cancel();throw Error('PDF exceeds acceptance size bound');}chunks.push(value);}const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}let binary='';for(let i=0;i<length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}finally{clearTimeout(timeout);}},url);}
async function nativeViewer(page,url,timeoutMs){
 const client=await page.createCDPSession(),until=Date.now()+timeoutMs;
 function hasPdf(node){const attrs=Object.fromEntries(Array.from({length:(node.attributes?.length??0)/2},(_,i)=>[node.attributes[i*2],node.attributes[i*2+1]]));return(['EMBED','OBJECT','IFRAME'].includes(node.nodeName)&&attrs.type==='application/pdf')||[...(node.children??[]),...(node.shadowRoots??[])].some(hasPdf);}
 try{do{const{root}=await client.send('DOM.getDocument',{depth:-1,pierce:true});if(root.documentURL===url&&hasPdf(root))return;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<until);const error=new Error('Native PDF viewer did not load');error.name='TimeoutError';throw error;}finally{await client.detach().catch(()=>{});}
}
export async function clickAndVerifyPdf({page,anchor,url,bytes,sha256,timeoutMs=20000}){
 assert.equal(await anchor.evaluate(a=>a.href),url);assert.equal(await anchor.evaluate(a=>a.tagName),'A');
 assert.ok(Number.isSafeInteger(Number(bytes))&&Number(bytes)>5&&Number(bytes)<=MAX_BYTES);assert.match(sha256,/^[a-f0-9]{64}$/);
 const context=page.browserContext(),browser=page.browser(),client=await browser.target().createCDPSession();
 const directory=await mkdtemp(path.join(os.tmpdir(),'squad-pdf-click-'));await chmod(directory,0o700);
 const browserContextId=context.id,contextArgs=browserContextId?{browserContextId}:{};
 const originalTargets=new Set(context.targets()),examined=new Set(),newTargets=new Set();let active=false,guid=null,timer,settled=false,succeeded=false;
 let resolve,reject;const result=new Promise((yes,no)=>{resolve=yes;reject=no;});result.catch(()=>{});
 const fail=error=>{if(!settled){settled=true;reject(error);}};
 const success=value=>{if(!settled){settled=true;succeeded=true;resolve(value);}};
 const begin=event=>{if(!active||event.url!==url)return;if(guid&&guid!==event.guid){fail(Error('Multiple downloads for one document click'));return;}if(!/^[a-zA-Z0-9-]+$/.test(event.guid)){fail(Error('Unexpected browser download identity'));return;}guid=event.guid;};
 const progress=async event=>{if(event.guid!==guid||settled)return;try{if(event.receivedBytes>MAX_BYTES){await client.send('Browser.cancelDownload',{guid,...contextArgs});throw Error('Clicked PDF exceeds size bound');}if(event.state==='canceled')throw Error('Browser PDF download cancelled');if(event.state!=='completed')return;const filename=path.join(directory,guid);let stats;for(let attempt=0;attempt<30;attempt++){try{stats=await lstat(filename);break;}catch(error){if(error.code!=='ENOENT')throw error;await new Promise(r=>setTimeout(r,20));}}assert.ok(stats?.isFile()&&!stats.isSymbolicLink(),'Completed browser download file unavailable');assert.equal(stats.size,Number(bytes));await chmod(filename,0o600);const proof=verify(await readFile(filename),{bytes,sha256});success({mode:'download',completed:true,...proof});}catch(error){fail(error);}};
 const inspect=async target=>{if(!active||settled||originalTargets.has(target)||target.type()!=='page')return;newTargets.add(target);if(target.url()!==url||examined.has(target))return;examined.add(target);try{const popup=await target.page();if(!popup)return;await nativeViewer(popup,url,Math.min(timeoutMs,10000));if(settled)return;assert.equal(popup.url(),url,'PDF viewer navigated away');const proof=verify(Buffer.from(await viewerBytes(popup,url),'base64'),{bytes,sha256});success({mode:'inline',completed:true,native_pdf_viewer:true,...proof});}catch(error){if(settled)return;if(error.name!=='TimeoutError'&&!String(error.message).includes('Target closed')&&!String(error.message).includes('detached'))fail(error);}};
 try{
  client.on('Browser.downloadWillBegin',begin);client.on('Browser.downloadProgress',progress);context.on('targetcreated',inspect);context.on('targetchanged',inspect);
  await client.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:directory,eventsEnabled:true,...contextArgs});
  timer=setTimeout(()=>fail(Error('PDF click produced neither a verified download nor a verified native viewer')),timeoutMs);
  active=true;await anchor.click();return await result;
 }finally{
  active=false;clearTimeout(timer);client.off('Browser.downloadWillBegin',begin);client.off('Browser.downloadProgress',progress);context.off('targetcreated',inspect);context.off('targetchanged',inspect);
  if(guid&&!succeeded)await client.send('Browser.cancelDownload',{guid,...contextArgs}).catch(()=>{});
  await client.send('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:false,...contextArgs}).catch(()=>{});
  for(const target of newTargets){const popup=await target.page().catch(()=>null);if(popup&&!popup.isClosed())await popup.close().catch(()=>{});}
  await client.detach().catch(()=>{});await rm(directory,{recursive:true,force:true});
 }
}
