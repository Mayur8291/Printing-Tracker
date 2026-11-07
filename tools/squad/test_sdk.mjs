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
const {error}=await client.auth.signInWithPassword(credentials);
if(error)throw new Error(`Controlled test login failed: ${error.code || error.status}`);
try {
  const sdk=createSquadClient(client),me=await sdk.me();
  assert.equal(me.role,3);
  const page=await sdk.orders({}, {limit:1});
  assert.ok(page.data.length<=1);
  assert.ok(page.data.every(o=>o.customer_id===me.id));
  assert.ok(page.data.every(o=>!('factory_manager_id' in o)));
  const dashboard=await sdk.dashboard();
  assert.ok(dashboard.orders>=page.data.length);
  await assert.rejects(sdk.people(),e=>e instanceof SquadError && e.kind==='forbidden');
  await assert.rejects(sdk.saveProfile({name:me.name||'Test'}, {expectedVersion:me.version,idempotencyKey:crypto.randomUUID()}),
    e=>e instanceof SquadError && e.kind==='unavailable');
  console.log(JSON.stringify({environment:'staging',sharedClient:true,identity:true,scopedOrders:true,dashboard:true,forbiddenDirectory:true,mirrorWriteDenied:true,businessWrites:0}));
} finally {
  await client.auth.signOut({scope:'local'});
}
