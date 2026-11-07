/** Hosted test of the actual shared mobile/web client. Never print credentials. */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createSquadClient, SquadError } from '../../packages/shared/squad.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const credentials=JSON.parse(readFileSync(process.env.SQUAD_TEST_CREDENTIALS || path.resolve(root,'../Canto/canto-sync/private/auth-test.json'),'utf8'));
const key=execFileSync(path.join(root,'tools/canto-sync/.venv/bin/python'),['-c',
  "import sys;sys.path.insert(0,'tools/canto-sync');from auth_test import keys;print(keys('staging'))"],{cwd:root,encoding:'utf8'}).trim();
const client=createClient('https://scvojtvgnkmbupvyslmb.supabase.co',key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const guest=createSquadClient(client);
const bootstrap=await guest.bootstrap('android','1.0.0');
assert.equal(bootstrap.client,'squad');
await assert.rejects(guest.settings('integrations'),e=>e instanceof SquadError && e.kind==='forbidden');
const {error}=await client.auth.signInWithPassword(credentials);
if(error)throw new Error(`Controlled test login failed: ${error.code || error.status}`);
try {
  const sdk=createSquadClient(client),me=await sdk.me();
  assert.equal(me.role,3);
  const promotions=await sdk.promotions({}, {limit:2});
  const categories=await sdk.promotions({mode:'categories'}, {limit:2});
  const banners=await sdk.banners({limit:2});
  assert.ok([promotions,categories,banners].every(p=>p.data.length<=2));
  const person=await sdk.person(me.id);
  assert.equal(person.id,me.id);
  assert.ok(Array.isArray(person.addresses));
  const requests=await sdk.coordinatorRequests({}, {limit:2});
  assert.ok(requests.data.every(r=>r.customer_id===me.id));
  const cities=await sdk.relationshipOptions('cities',{}, {limit:2});
  assert.ok(cities.data.length<=2 && cities.data.every(c=>Object.keys(c).every(k=>['id','name','parent_id'].includes(k))));
  await assert.rejects(sdk.reviewCustomer(me.id,{approved:true},'Forbidden self approval',{expectedVersion:me.version,idempotencyKey:crypto.randomUUID()}),e=>e instanceof SquadError && e.kind==='forbidden');
  const page=await sdk.orders({}, {limit:1});
  assert.ok(page.data.length<=1);
  assert.ok(page.data.every(o=>o.customer_id===me.id));
  assert.ok(page.data.every(o=>!('factory_manager_id' in o)));
  if(page.data.length) {
    const feedback=await sdk.ratings('Order',page.data[0].id,{}, {limit:2});
    assert.ok(feedback.data.every(r=>r.from_id===me.id||r.to_id===me.id));
  }
  const dashboard=await sdk.dashboard();
  assert.ok(dashboard.orders>=page.data.length);
  const catalogue=await sdk.catalogue('products',{}, {limit:2});
  assert.ok(catalogue.data.length<=2 && catalogue.data.every(p=>!('costs' in p)));
  if(catalogue.data.length) {
    const product=await sdk.baseProduct(catalogue.data[0].id);
    assert.equal(product.id,catalogue.data[0].id);
    const fabrics=await sdk.configuratorOptions(product.id,'fabrics',{}, {limit:2});
    assert.ok(fabrics.data.every(f=>!('price' in f)));
  }
  const readyMade=await sdk.readyMade({},null,{limit:2});
  assert.ok(readyMade.data.length<=2);
  if(readyMade.data.length) {
    const variants=await sdk.readyMadeVariants(readyMade.data[0].id,null,{}, {limit:2});
    assert.ok(variants.data.every(v=>v.availability.one_day===null));
  }
  await assert.rejects(sdk.people(),e=>e instanceof SquadError && e.kind==='forbidden');
  await assert.rejects(sdk.saveProfile({name:me.name||'Test'}, {expectedVersion:me.version,idempotencyKey:crypto.randomUUID()}),
    e=>e instanceof SquadError && e.kind==='unavailable');
  console.log(JSON.stringify({environment:'staging',sharedClient:true,identity:true,scopedOrders:true,dashboard:true,catalogue:true,readyMade:true,costRedaction:true,forbiddenDirectory:true,mirrorWriteDenied:true,businessWrites:0}));
} finally {
  await client.auth.signOut({scope:'local'});
}
