/** Exact-route browser readiness with bounded, credential-free navigation evidence.
 * Never retries or lengthens a deadline. The caller owns persistence of error.navigationTrace. */
import assert from 'node:assert/strict';
const safePath=value=>{try{const u=new URL(value);return /^\/squad\/[a-z0-9/-]{1,160}$/.test(u.pathname)?u.pathname:'[other-route]';}catch{return '[invalid-route]';}};
export async function navigateWorkspace(page,base,path,{timeout=30000}={}){
 const origin=new URL(base);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 assert.ok(typeof path==='string'&&(/^\/squad\/[a-z0-9/-]{1,160}$/.test(path)||/^\/squad\/tasks\?order_id=[1-9]\d{0,18}$/.test(path)),'Unsupported workspace route');
 const target=new URL(path,origin).href,events=[],started=performance.now();let response=null;
 const append=(kind,url,status=null)=>{if(events.length<8)events.push({kind,path:safePath(url),status,elapsed_ms:Math.round(performance.now()-started)});};
 const navigated=frame=>{if(frame===page.mainFrame())append('frame',frame.url());};
 const failed=request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())append('request_failed',request.url());};
 page.on('framenavigated',navigated);page.on('requestfailed',failed);
 try{
  response=await page.goto(target,{waitUntil:'domcontentloaded',timeout});
  const remaining=Math.max(1,timeout-(performance.now()-started));
  await page.waitForFunction((target)=>location.href===target&&!!document.querySelector('.squad-app'),{timeout:remaining},target);
  assert.equal(page.url(),target,'Workspace navigation reached a different route');
  assert.ok(response===null||response.ok()||response.status()===304,'Workspace navigation returned an unsuccessful HTTP status');
  return page;
 }catch(error){
  let snapshotTimer;const actual=await Promise.race([page.evaluate(()=>({url:location.href,app:!!document.querySelector('.squad-app'),ready:document.readyState})).catch(()=>null),new Promise(resolve=>{snapshotTimer=setTimeout(()=>resolve(null),750);})]).finally(()=>clearTimeout(snapshotTimer));
  error.navigationTrace={requested_path:safePath(target),response_status:response?.status()??null,response_path:response?safePath(response.url()):null,actual_path:actual?safePath(actual.url):safePath(page.url()),app_present:actual?.app??null,document_ready:['loading','interactive','complete'].includes(actual?.ready)?actual.ready:null,elapsed_ms:Math.round(performance.now()-started),events};
  throw error;
 }finally{page.off('framenavigated',navigated);page.off('requestfailed',failed);}
}
