import test from 'node:test';
import assert from 'node:assert/strict';
import {createSquadClient} from './squad.js';
test('Dealer linked Customer item uses exact scoped RPC and query signal',async()=>{
 const calls=[];const sdk=createSquadClient({schema:()=>({rpc(name,args){const entry={name,args,signal:null};calls.push(entry);const p=Promise.resolve({data:{context:{customer_id:'1',dealer_id:'2',order_id:'3'}},error:null});p.abortSignal=s=>{entry.signal=s;return p};return p}}),functions:{invoke(){throw Error('unexpected')}}});
 const signal=new AbortController().signal,result=await sdk.withSignal(signal).dealerCustomerOrderItem('1','3','4','images',{cursor:'cursor',limit:11});
 assert.deepEqual(result.context,{customer_id:'1',dealer_id:'2',order_id:'3'});
 assert.deepEqual(calls,[{name:'v1_dealer_customer_item_get',args:{p_customer_id:'1',p_order_id:'3',p_item_id:'4',p_section:'images',p_cursor:'cursor',p_limit:11},signal}]);
 await sdk.dealerCustomerOrderItem('1','3','4');assert.deepEqual(calls[1].args,{p_customer_id:'1',p_order_id:'3',p_item_id:'4',p_section:'quantities',p_cursor:null,p_limit:30});
});
