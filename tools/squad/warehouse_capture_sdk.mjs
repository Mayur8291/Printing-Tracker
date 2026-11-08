/** Minimal real shared-SDK capture over the rollback SQL bridge; no HTTP. */
import assert from 'node:assert/strict';
import readline from 'node:readline';
import {createSquadClient} from '../../packages/shared/squad.js';
const lines=readline.createInterface({input:process.stdin})[Symbol.asyncIterator]();
const next=async()=>{const x=await lines.next();if(x.done)throw Error('Capture bridge closed');return JSON.parse(x.value);};
const send=x=>process.stdout.write(JSON.stringify(x)+'\n');
try{
 const cfg=await next();
 const client=role=>createSquadClient({schema(name){assert.equal(name,'canto_api');return {rpc:async(name,args)=>{send({kind:'rpc',role,name,args});return await next();}};}});
 const customer=client(3),sc=client(1),request={customer_id:String(cfg.customer_id),address_id:String(cfg.address_id),lines:[{kind:'rmp',skus:[{sku_id:String(cfg.sku_id),quantity:1}]}]};
 const q=await customer.quote(request);assert.equal(q.quantity,1);assert.ok(Number(q.total)>0&&Number(q.total)<=1000);
 const details={due_at:cfg.due_at,comment:'DO NOT FULFIL: controlled Squad backend acceptance',line_settings:{[String(q.lines[0].line)]:{comment:'Controlled test: cancel immediately'}}};
 const placed=await customer.placeOrder(q.quote_id,details,{expectedVersion:q.version,idempotencyKey:crypto.randomUUID()});assert.equal(placed.orders.length,1);
 const id=placed.orders[0].id;assert.equal(String(id),String(cfg.order_id));
 send({kind:'capture_initial',order_id:String(id)});assert.equal((await next()).captured,true);
 const current=await sc.order(id),q2=await sc.quote(request);
 const edited=await sc.editOrder(id,q2.quote_id,q2.version,{...details,due_at:cfg.replacement_due_at,comment:'DO NOT FULFIL: controlled replacement acceptance'},'Controlled provider amendment acceptance',{expectedVersion:current.version,idempotencyKey:crypto.randomUUID()});
 assert.equal(edited.state,'queued');assert.ok(edited.request_id);
 send({kind:'result',order_id:String(id),request_id:edited.request_id,quoted_total:String(q.total),replacement_total:String(q2.total)});
}catch(e){send({kind:'failed',code:e.code??'CAPTURE_ASSERTION',message:e.message});process.exitCode=1;}
