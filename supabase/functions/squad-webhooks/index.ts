import {createHandler,serviceAcceptance,PROJECTS,type ProjectRef} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL')??'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const match=url.match(/^https:\/\/([a-z]{20})\.supabase\.co$/),projectRef=match?.[1] as ProjectRef;
const configured=Boolean(key&&Object.hasOwn(PROJECTS,projectRef)&&Deno.env.get('SQUAD_WEBHOOK_ENVIRONMENT')===PROJECTS[projectRef]);
const secrets=[Deno.env.get('SQUAD_DASHBOARD_WEBHOOK_SECRET'),Deno.env.get('SQUAD_DASHBOARD_WEBHOOK_PREVIOUS_SECRET')].filter((v):v is string=>Boolean(v));
// Deployment requires JWT verification disabled: authentication is the
// environment-specific provider HMAC, never a browser's Supabase session.
Deno.serve(createHandler({projectRef,enabled:configured&&Deno.env.get('SQUAD_WEBHOOK_ENABLED')==='true',secrets,accept:serviceAcceptance(url,key)}));
