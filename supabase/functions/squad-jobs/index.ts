import {createHandler,serviceRpc, storageCleanup} from './handler.ts';
import {reconcileAccount,authAdmin} from './accounts.ts';
const url=Deno.env.get('SUPABASE_URL');
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if(!url || !key)throw new Error('Supabase service configuration missing');
const rpc=serviceRpc(url,key);
Deno.serve(createHandler(Deno.env.get('SQUAD_JOBS_SECRET'),rpc,storageCleanup(url,key),reconcileAccount(rpc,authAdmin(url,key))));
