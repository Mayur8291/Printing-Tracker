import {createHandler,serviceRpc, storageCleanup,scheduledMaintenance} from './handler.ts';
import {reconcileAccount,authAdmin} from './accounts.ts';
import {accountMail} from './account-mail.ts';
import {accountCrypto} from '../_shared/squad-account-crypto.ts';
import {proofMailer} from '../_shared/squad-mail.ts';
import {documentMailWorker,documentMailer} from './document-mail.ts';
import {documentWorker,documentStorage} from './documents.ts';
import {transferWorker,transferStorage} from './transfers.ts';
import {warehouseWorker,warehouseAdapters} from './warehouse.ts';
import {warehouseReadCheck} from './warehouse-check.ts';
import {businessMailWorker,businessMailer} from './business-mail.ts';
import {airtableWorker} from './airtable.ts';
import {airtableFromEnvironment,airtableStorage} from './airtable-provider.ts';
import {airtableReportWorker,reportsFromEnvironment} from './airtable-reports.ts';
import {dispatchNotifications,fcmPush,parseFcmAccount} from './notifications.ts';
const url=Deno.env.get('SUPABASE_URL');
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if(!url || !key)throw new Error('Supabase service configuration missing');
const rpc=serviceRpc(url,key);
const projectRef=new URL(url).hostname.split('.')[0];
const flowSecret=Deno.env.get('SQUAD_ACCOUNT_SECRET');
const mailHost=Deno.env.get('SQUAD_SMTP_HOST');
const mail=flowSecret&&mailHost?accountMail(rpc,accountCrypto(flowSecret),proofMailer({projectRef,host:mailHost,port:Number(Deno.env.get('SQUAD_SMTP_PORT')??2525),username:Deno.env.get('SQUAD_SMTP_USERNAME')??'',password:Deno.env.get('SQUAD_SMTP_PASSWORD')??'',sender:Deno.env.get('SQUAD_SMTP_SENDER')??'',...(Deno.env.get('SQUAD_MAIL_ALLOWLIST')?{allowedRecipients:Deno.env.get('SQUAD_MAIL_ALLOWLIST')!.split(',').map(x=>x.trim().toLowerCase())}:{})})):undefined;
const firebase=Deno.env.get('SQUAD_FIREBASE_SERVICE_ACCOUNT');
// This shared legacy Firebase project also serves the old app. Staging cannot
// send to an imported physical device even if a secret is accidentally changed.
const pushMode=url==='https://scvojtvgnkmbupvyslmb.supabase.co'?'validate_only':Deno.env.get('SQUAD_PUSH_MODE')==='deliver'?'deliver':'validate_only';
const push=dispatchNotifications(rpc,fcmPush(parseFcmAccount(firebase),pushMode,fetch,new URL(url).hostname.split('.')[0]));
const files=documentStorage(url,key);
const mailConfig={host:mailHost??'',port:Number(Deno.env.get('SQUAD_SMTP_PORT')??2525),username:Deno.env.get('SQUAD_SMTP_USERNAME')??'',password:Deno.env.get('SQUAD_SMTP_PASSWORD')??'',sender:Deno.env.get('SQUAD_SMTP_SENDER')??'',...(Deno.env.get('SQUAD_MAIL_ALLOWLIST')?{allowedRecipients:Deno.env.get('SQUAD_MAIL_ALLOWLIST')!.split(',').map(x=>x.trim().toLowerCase())}:{})};
const documents={run:documentWorker(rpc,files),mail:documentMailWorker(rpc,files,documentMailer({...mailConfig,projectRef})),remove:async(paths:string[])=>{
 const r=await fetch(url+'/storage/v1/object/squad-documents',{method:'DELETE',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({prefixes:paths}),signal:AbortSignal.timeout(12000)});
 if(!r.ok){await r.body?.cancel();throw new Error('document_cleanup_failed');}await r.body?.cancel();
}};
const transfers={run:transferWorker(rpc,transferStorage(url,key)),remove:async(paths:string[])=>{
 const r=await fetch(url+'/storage/v1/object/squad-transfers',{method:'DELETE',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({prefixes:paths}),signal:AbortSignal.timeout(12000),redirect:'error'});
 if(!r.ok){await r.body?.cancel();throw new Error('transfer_cleanup_failed');}await r.body?.cancel();
}};
const domain={documentRehearsalProjectRef:projectRef==='scvojtvgnkmbupvyslmb'?projectRef:undefined,warehouseCheck:warehouseReadCheck(name=>Deno.env.get(name)),heartbeat:()=>scheduledMaintenance(rpc),warehouse:warehouseWorker(rpc,warehouseAdapters(name=>Deno.env.get(name))),businessMail:businessMailWorker(rpc,files,businessMailer({...mailConfig,projectRef})),airtable:airtableWorker(rpc,airtableFromEnvironment(name=>Deno.env.get(name)),airtableStorage(url,key)),airtableReport:airtableReportWorker(rpc,reportsFromEnvironment(name=>Deno.env.get(name)))};
Deno.serve(createHandler(Deno.env.get('SQUAD_JOBS_SECRET'),rpc,storageCleanup(url,key),reconcileAccount(rpc,authAdmin(url,key)),mail,push,documents,transfers,domain));
