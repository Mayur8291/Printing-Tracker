import assert from 'node:assert/strict';
import {createSquadClient,SquadError} from '../../packages/shared/squad.js';
const stage='scvojtvgnkmbupvyslmb',prod='levwrmvqdntngeasrtnb';let calls=0,error=null;
const sdk=createSquadClient({schema:()=>({rpc:async(name,args)=>{calls++;assert.equal(name,'v1_notifications_list');assert.equal(args.p_generation,'0');return{data:{data:[{id:args.p_id}],generation:'0'},error};}})});
assert.equal(await sdk.notificationFromPush({project_ref:prod,notification_id:'1',generation:'0'},stage),null);
assert.equal(await sdk.notificationFromPush({project_ref:stage,notification_id:'9223372036854775808',generation:'0'},stage),null);
assert.equal(calls,0);
assert.equal((await sdk.notificationFromPush({project_ref:stage,notification_id:'1',generation:'0'},stage)).id,'1');
for(const code of ['PT409','40001']){
 error={code};const before=calls;
 assert.equal(await sdk.notificationFromPush({project_ref:stage,notification_id:'1',generation:'0'},stage),null);
 assert.equal(calls,before+1,'Stale push lookup must make one request without SDK retries');
}
error={code:'23505'};await assert.rejects(sdk.notificationFromPush({project_ref:stage,notification_id:'1',generation:'0'},stage),e=>e instanceof SquadError&&e.code==='23505');
error={code:'28000'};await assert.rejects(sdk.notificationFromPush({project_ref:stage,notification_id:'1',generation:'0'},stage),e=>e instanceof SquadError&&e.kind==='session');
console.log('Push resolution: environment, generation, integer bounds and current-session errors verified');
