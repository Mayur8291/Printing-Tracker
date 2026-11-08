import {createHandler,dependencies} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if(!url||!anon||!service)throw new Error('Supabase account configuration missing');
Deno.serve(createHandler(dependencies(url,anon,service)));
