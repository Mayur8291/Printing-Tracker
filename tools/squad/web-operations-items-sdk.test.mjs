/** Offline SDK argument contract: no network client or credentials. */
import assert from 'node:assert/strict';
import {createSquadClient} from '../../packages/shared/squad.js';
const calls=[];const sdk=createSquadClient({schema(name){assert.equal(name,'canto_api');return{rpc:async(name,args)=>{calls.push({name,args});return{data:{data:[],next_cursor:null},error:null};}};}});
await sdk.operationalItems();assert.deepEqual(calls.pop(),{name:'v1_operational_items',args:{p_tailor_id:null,p_completed:false,p_item_id:null,p_order_id:null,p_cursor:null,p_limit:30}});
await sdk.operationalItems({tailorId:'9007199254740993',completed:true,itemId:'41',orderId:'12'},{cursor:'bound',limit:25});assert.deepEqual(calls.pop().args,{p_tailor_id:'9007199254740993',p_completed:true,p_item_id:'41',p_order_id:'12',p_cursor:'bound',p_limit:25});
await sdk.operationalItems({completed:null});assert.equal(calls.pop().args.p_completed,null);
console.log('PASS3 offline operational item SDK argument contracts');
