import {createHandler,serviceRpc, storageCleanup} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL');
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if(!url || !key)throw new Error('Supabase service configuration missing');
Deno.serve(createHandler(Deno.env.get('SQUAD_JOBS_SECRET'),serviceRpc(url,key),storageCleanup(url,key)));
