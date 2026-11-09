/** Bounded browser lifetime. The parent must still preserve its checkpoint if
 * the process is killed before browser closure can be confirmed. */
export class BrowserShutdownUnconfirmed extends Error {
  constructor(){super('Browser shutdown could not be confirmed');this.name='BrowserShutdownUnconfirmed';}
}
export function createBrowserShutdownGuard(browser,{deadlineMs=240000,signals=process}={}) {
  let reason=null,closing=null,disposed=false;
  const close=()=>closing??=(async()=>{await browser.close();})();
  const terminate=()=>{reason??='signal';void close().catch(()=>{});};
  signals.on('SIGTERM',terminate);signals.on('SIGINT',terminate);
  const timer=setTimeout(()=>{reason??='deadline';void close().catch(()=>{});},deadlineMs);
  timer.unref?.();
  return {
    assertActive(){if(reason)throw new Error(reason==='deadline'?'Browser acceptance deadline exceeded':'Browser acceptance interrupted');},
    get reason(){return reason;},
    async dispose(){
      if(!disposed){disposed=true;clearTimeout(timer);signals.off('SIGTERM',terminate);signals.off('SIGINT',terminate);}
      try{await close();}catch{throw new BrowserShutdownUnconfirmed();}
    },
  };
}
