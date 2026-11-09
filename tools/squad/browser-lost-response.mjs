import assert from 'node:assert/strict';

/** Lose exactly one successful RPC response after the server completed it.
 * This does not mock the result or issue a command itself. Caller must verify
 * durable state, retry using the unchanged UI, and assert identical intent.
 */
export async function loseNextRpcResponse(page,rpcName,{origin,timeoutMs=30_000}={}){
 assert.match(rpcName,/^v1_[a-z_]+$/);assert.equal(new URL(origin).origin,origin,'Exact expected RPC origin is required');
 const session=await page.createCDPSession();let timer,disposed=false,settled=false;
 let resolve,reject;const lost=new Promise((yes,no)=>{resolve=yes;reject=no;});lost.catch(()=>{});
 async function onPaused(event){
  try{
   const matches=new URL(event.request.url).origin===origin&&new URL(event.request.url).pathname===`/rest/v1/rpc/${rpcName}`&&event.request.method==='POST';
   if(!matches||settled){await session.send('Fetch.continueRequest',{requestId:event.requestId});return;}
   settled=true;clearTimeout(timer);
   if(!(event.responseStatusCode>=200&&event.responseStatusCode<300)){
    await session.send('Fetch.continueRequest',{requestId:event.requestId});throw new Error('Expected a successful server response before simulating connection loss');
   }
   const payload=JSON.parse(event.request.postData);assert.match(payload.p_idempotency_key,/^[0-9a-f-]{36}$/);
   await session.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'ConnectionClosed'});
   resolve({payload,status:event.responseStatusCode});
  }catch(error){reject(error);}
 }
 session.on('Fetch.requestPaused',onPaused);
 await session.send('Fetch.enable',{patterns:[{urlPattern:`${origin}/rest/v1/rpc/${rpcName}`,requestStage:'Response'}]});
 timer=setTimeout(()=>{settled=true;reject(new Error('Expected RPC response was not intercepted'));},timeoutMs);
 return {lost,async dispose(){if(disposed)return;disposed=true;clearTimeout(timer);session.off('Fetch.requestPaused',onPaused);await session.send('Fetch.disable');await session.detach();}};
}
