/** Test-only observer. Firefox reports exceptions from rejected Web Locks callbacks
 * through Playwright pageerror even when the caller catches the rejection. Never
 * suppress a native error event, another error, or an incomplete auth/UI journey. */
export const EXPECTED_STAGING_LOCK_MESSAGE='Acquiring an exclusive Navigator LockManager lock "lock:sb-scvojtvgnkmbupvyslmb-auth-token" immediately failed';
export function classifyBrowserErrors({engine,pageErrors,nativeErrors,completed}) {
 const expectedCaughtLockDiagnostics=[],errors=[...nativeErrors];
 for(const error of pageErrors){
  if(engine==='firefox'&&completed&&nativeErrors.length===0&&error.name==='Error'&&error.message===EXPECTED_STAGING_LOCK_MESSAGE){
   expectedCaughtLockDiagnostics.push({...error,classification:'firefox_caught_zero_wait_lock_callback'});
  }else errors.push(error);
 }
 return {errors,expectedCaughtLockDiagnostics};
}
export async function observeBrowserErrors(page,{engine,sensitive=[]}={}) {
 const pageErrors=[],nativeErrors=[];
 const clean=value=>{let text=String(value??'');for(const secret of sensitive.filter(Boolean))text=text.split(secret).join('[redacted]');return text.slice(0,500);};
 page.on('pageerror',error=>pageErrors.push({source:'playwright_pageerror',name:clean(error.name),message:clean(error.message)}));
 await page.exposeBinding('__squadReportNativeError',(_source,error)=>{
  nativeErrors.push({source:error.type,name:clean(error.name),message:clean(error.message)});
 });
 await page.addInitScript(()=>{
  const pending=[];Object.defineProperty(window,'__squadNativeErrorPending',{value:pending});
  const report=(type,error)=>{const entry=window.__squadReportNativeError({type,name:typeof error?.name==='string'?error.name:'Error',message:typeof error?.message==='string'?error.message:String(error)});pending.push(entry);entry.catch(()=>{});};
  window.addEventListener('error',event=>report('window_error',event.error??{name:'Error',message:event.message}));
  window.addEventListener('unhandledrejection',event=>report('unhandled_rejection',event.reason));
 });
 return {
  async finish(completed){
   // Allow the native unhandled-rejection checkpoint, then drain exposed-binding
   // deliveries before evaluating success. Listeners are active on every document.
   await page.evaluate(async()=>{await new Promise(resolve=>setTimeout(resolve,0));await Promise.all(window.__squadNativeErrorPending??[]);});
   return {pageErrors:[...pageErrors],nativeErrors:[...nativeErrors],...classifyBrowserErrors({engine,pageErrors,nativeErrors,completed})};
  },
 };
}
