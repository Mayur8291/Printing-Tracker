import {airtableContracts,normalizeAirtable,freshAttachment,AirtableError,attachmentUrl,type Attachment} from './airtable-mapping.ts';
import {airtableProvider,airtableFromEnvironment,airtableStorage,readBounded,type AirtableProvider,type AirtableStorage} from './airtable-provider.ts';
import {airtableWorker} from './airtable.ts';
import type {Rpc} from './handler.ts';
function assert(value:unknown,message='assertion failed'):asserts value{if(!value)throw new Error(message);}
async function rejects(fn:()=>unknown|Promise<unknown>,code?:string){try{await fn();}catch(error){if(code)assert(error instanceof AirtableError&&error.code===code,String(error));return;}throw new Error('Expected rejection');}
const rec='rec12345678901234',other='rec22345678901234',att='att12345678901234';
const attachment={id:att,url:'https://v5.airtableusercontent.com/private/expiring',filename:'image.jpg',size:4,type:'image/jpeg',thumbnails:{large:{url:'https://v5.airtableusercontent.com/private/thumbnail'}}};
const photo:Attachment={id:att,url:attachment.url,filename:attachment.filename,bytes:4,mime:'image/jpeg',variant:'original'};
const row=(fields:Record<string,unknown>={},id=rec)=>({id,fields});
const json=(value:unknown,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
const bases={custom:{id:'app12345678901234',token:'private-custom'},ready_stock:{id:'app22345678901234',token:'private-ready'}};
const signal=()=>new AbortController().signal;
const provider=(request:typeof fetch)=>airtableProvider(bases,request,0);
const fixtureProvider:AirtableProvider={page:async()=>({records:[row({Name:'Blue'})],offset:null}),record:async()=>row({Image: [attachment]}),media:async()=>({bytes:new Uint8Array([255,216,255,217]),mime:'image/jpeg'})};
const fixtureStorage:AirtableStorage={put:async()=>({bucket:'canto-media',path:'sha256/aa/'+'a'.repeat(64),sha256:'a'.repeat(64),bytes:4,mime:'image/jpeg'})};
const job={id:'11111111-1111-4111-8111-111111111111',lease_token:'lease-secret'};
Deno.test('Airtable base product keeps scalar/reference/name relationships distinct',()=>{
 const result=normalizeAirtable('base_products',row({'Base Product':'Polo','Trims Cost':2,'branding Sides':'front','Product Categories':['Uniforms'],'Parts':[other],'Base Product Type':[rec,other]}));
 assert(result.attributes.name==='Polo'&&result.attributes.tims_cost===2);assert(result.references.base_product_type_id.airtable_id===rec);assert(result.relations.categories[0]==='Uniforms');assert(result.relations.parts[0]===other);assert(result.media.image===null);assert(!('airtable_id' in result.attributes));
});
Deno.test('Airtable absent fields preserve original defaults and booleans',()=>{
 const add=normalizeAirtable('add_ons',row({'hasColour':'FALSE','Add On':'Collar'}));assert(add.attributes.has_color===false);
 const price=normalizeAirtable('rmp_prices',row({'Price':10}));assert(price.attributes.mrp===0);
 const fabric=normalizeAirtable('fabrics',row({'Fabric Type':'POLY COTTON'}));assert(fabric.attributes.fabric_type==='poly_cotton'&&fabric.attributes.uom==='');
 const size=normalizeAirtable('rmp_sizes',row({'Size Type':'Free Size'}));assert(size.attributes.size_type==='free_size');
});
Deno.test('Airtable retains explicit empty relations without importing provider metadata',()=>{
 const result=normalizeAirtable('parts',{...row({'Name':'Sleeve'}),createdTime:'2000-01-01',backend_id:2,source:1});assert(result.relations.colors.length===0&&result.attributes.name==='Sleeve');assert(!JSON.stringify(result).includes('backend_id'));
});
Deno.test('Airtable singular refs use original first-linked-record semantics',()=>{
 const result=normalizeAirtable('rmp_skus',row({'Size':[rec,other]}));assert(result.references.rmp_size_id.airtable_id===rec&&result.references.rmp_brand_id.airtable_id===null);
});
Deno.test('Airtable rejects malformed identities, links and nested scalar payloads',async()=>{
 for(const [resource,value] of [['colors',row({},'../escape')],['colors',row({Name:{sql:'bad'}})],['parts',row({Colour:[rec,rec]})],['parts',row({Colour:['arbitrary-id']})],['fabrics',row({'Fabric Type':'unsupported'})]] as const)await rejects(()=>normalizeAirtable(resource,value));
 await rejects(()=>normalizeAirtable('__proto__',row()),'AIRTABLE_INVALID_RESOURCE');
});
Deno.test('Airtable captured image and thumbnail share attachment identity but distinct variants',()=>{
 const result=normalizeAirtable('rmp_classes',row({Image1:[attachment]}));assert(result.media.image_1?.variant==='original');assert(result.media.image_1_thumb?.variant==='large');assert(result.media.image_1_thumb?.bytes===4);assert(result.media.image_2===null);
});
Deno.test('Airtable refreshing URL cannot silently replace captured attachment or metadata',async()=>{
 const fresh={...attachment,url:'https://v5.airtableusercontent.com/fresh'};
 assert(freshAttachment('base_products',rec,'image',photo,row({Image:[fresh]})).url===fresh.url);
 for(const change of [{id:'att22345678901234'},{size:9},{type:'image/png'},{filename:'other.jpg'}])await rejects(()=>freshAttachment('base_products',rec,'image',photo,row({Image:[{...fresh,...change}]})),'AIRTABLE_MEDIA_CHANGED');
 await rejects(()=>freshAttachment('base_products',rec,'image',photo,row({Image:[fresh]},other)),'AIRTABLE_MEDIA_CHANGED');
});
Deno.test('Airtable download URL allowlist rejects credentials, alternate ports and lookalike hosts',async()=>{
 for(const url of ['http://airtableusercontent.com/a','https://airtableusercontent.com.attacker.invalid/a','https://user:pass@airtableusercontent.com/a','https://airtableusercontent.com:444/a','https://127.0.0.1/a','https://airtable.com/a'])await rejects(()=>attachmentUrl(url),'AIRTABLE_INVALID_MEDIA');
});
Deno.test('Airtable exact table/base and encoded offset use read-only provider requests',async()=>{
 let seen=false;const p=provider(async(input,init)=>{const u=new URL(String(input));assert(u.origin==='https://api.airtable.com');assert(u.pathname===`/v0/${bases.ready_stock.id}/${airtableContracts.authorized_brands.table}`);assert(u.searchParams.get('offset')==='next/token?a=b');assert(u.searchParams.get('pageSize')==='100');assert(init?.redirect==='error'&&(init?.headers as Record<string,string>).Authorization==='Bearer private-ready');assert(!init?.method);seen=true;return json({records:[],offset:'another'});});
 const page=await p.page('authorized_brands','next/token?a=b',signal());assert(seen&&page.offset==='another');
});
Deno.test('Airtable rate-limit response produces durable thirty-second retry without body leakage',async()=>{
 const p=provider(async()=>json({secret:'must-not-escape'},429));try{await p.page('colors',null,signal());throw new Error('Expected rejection');}catch(e){assert(e instanceof AirtableError&&e.retryAfter===30&&!e.message.includes('secret'));}
});
Deno.test('Airtable cancelled queued call cannot let a later request overtake the active request',async()=>{
 let finishFirst=()=>{},enteredFirst=()=>{};let count=0;
 const entered=new Promise<void>(resolve=>{enteredFirst=resolve;}),held=new Promise<void>(resolve=>{finishFirst=resolve;});
 const p=provider(async()=>{count++;if(count===1){enteredFirst();await held;}return json({records:[]});});
 const first=p.page('colors',null,signal());await entered;
 const cancel=new AbortController(),second=p.page('colors',null,cancel.signal),rejected=rejects(()=>second);
 cancel.abort();await rejected;
 const third=p.page('colors',null,signal());
 // Flush queued work and any zero-spacing timer while the first request is held.
 await new Promise(resolve=>setTimeout(resolve,10));assert(count===1,'cancelled waiter opened the queue early');
 finishFirst();await Promise.all([first,third]);assert(Number(count)===2);
});
Deno.test('Airtable impossible page size and repeated cursor fail rather than loop',async()=>{
 await rejects(()=>provider(async()=>json({records:Array.from({length:101},()=>row())})).page('colors',null,signal()),'AIRTABLE_RESPONSE_INVALID');
 await rejects(()=>provider(async()=>json({records:[],offset:'same'})).page('colors','same',signal()),'AIRTABLE_RESPONSE_INVALID');
});
Deno.test('Airtable deadline aborts stalled response streams',async()=>{
 const response=new Response(new ReadableStream({start(){},cancel(){}}));const start=performance.now();await rejects(()=>readBounded(response,1024,AbortSignal.timeout(10)));assert(performance.now()-start<500);
});
Deno.test('Airtable response byte limits stop oversized data',async()=>{await rejects(()=>readBounded(new Response('x'.repeat(101)),100,signal()),'AIRTABLE_RESPONSE_LIMIT');});
Deno.test('Airtable attachment download carries no secret headers and verifies original size',async()=>{
 let seen=false;const p=provider(async(_url,init)=>{assert(!init?.headers&&init?.redirect==='error');seen=true;return new Response(new Uint8Array([255,216,255,217]),{headers:{'Content-Type':'image/jpeg'}});});
 const file=await p.media(photo,signal());assert(seen&&file.bytes.length===4);await rejects(()=>p.media({...photo,bytes:5},signal()),'AIRTABLE_MEDIA_CHANGED');
});
Deno.test('Airtable thumbnails use actual downloaded MIME and size',async()=>{
 const p=provider(async()=>new Response(new Uint8Array([255,216,255,217]),{headers:{'Content-Type':'image/jpeg'}}));const file=await p.media({...photo,bytes:999,mime:'image/png',variant:'large'},signal());assert(file.bytes.length===4&&file.mime==='image/jpeg');
});
Deno.test('Airtable configuration fails closed for cross-environment or missing isolation',()=>{
 const env:Record<string,string>={SUPABASE_URL:'https://scvojtvgnkmbupvyslmb.supabase.co',SQUAD_AIRTABLE_ENABLED:'true',SQUAD_AIRTABLE_ENVIRONMENT:'production',SQUAD_AIRTABLE_ISOLATED_ENVIRONMENT:'production',SQUAD_AIRTABLE_CUSTOM_BASE:bases.custom.id,SQUAD_AIRTABLE_CUSTOM_TOKEN:bases.custom.token,SQUAD_AIRTABLE_READY_STOCK_BASE:bases.ready_stock.id,SQUAD_AIRTABLE_READY_STOCK_TOKEN:bases.ready_stock.token};
 assert(!airtableFromEnvironment(n=>env[n]));env.SQUAD_AIRTABLE_ENVIRONMENT='staging';assert(!airtableFromEnvironment(n=>env[n]));env.SQUAD_AIRTABLE_ISOLATED_ENVIRONMENT='staging';assert(airtableFromEnvironment(n=>env[n]));
});
Deno.test('Airtable media is magic-verified before private immutable upload',async()=>{
 let count=0;const storage=airtableStorage('https://scvojtvgnkmbupvyslmb.supabase.co','private',async(input,init)=>{count++;assert(String(input).includes('/object/canto-media/sha256/'));assert((init?.headers as Record<string,string>)['x-upsert']==='false');return json({Key:'stored'});});
 await rejects(()=>storage.put(new TextEncoder().encode('<script>bad</script>'),'image/jpeg',signal()),'AIRTABLE_INVALID_MEDIA');assert(count===0);
 const manifest=await storage.put(new Uint8Array([255,216,255,217]),'image/jpeg',signal());assert(Number(count)===1&&manifest.path===`sha256/${manifest.sha256.slice(0,2)}/${manifest.sha256}`);
});
Deno.test('Airtable duplicate Storage path must prove exact bytes instead of trusting name',async()=>{
 let calls=0;const storage=airtableStorage('https://scvojtvgnkmbupvyslmb.supabase.co','private',async()=>++calls===1?json({statusCode:'409'},400):new Response(new Uint8Array([255,216,0,217]),{headers:{'Content-Type':'image/jpeg'}}));
 await rejects(()=>storage.put(new Uint8Array([255,216,255,217]),'image/jpeg',signal()));assert(calls===2);
});
Deno.test('Airtable worker captures a bounded page and yields its lease after step limit',async()=>{
 const actions:string[]=[];const rpc:Rpc=async(_name,args)=>{actions.push(String(args.p_action));if(args.p_action==='input')return{state:'ready',phase:'capture',resource:'colors',offset:null};if(args.p_action==='capture'){const input=args.p_input as {records:unknown[];eof:boolean};assert(input.records.length===1&&input.eof);return{state:'ready'};}return{id:job.id,state:'pending'};};
 const result=await airtableWorker(rpc,fixtureProvider,fixtureStorage,35000,1)(job);assert(result.state==='pending'&&actions.join(',')==='input,capture,yield');
});
Deno.test('Airtable worker never converts uncertain checkpoint into failure',async()=>{
 const actions:string[]=[];const rpc:Rpc=async(_name,args)=>{actions.push(String(args.p_action));if(args.p_action==='input')return{state:'ready',phase:'capture',resource:'colors',offset:null};throw new Error('lost checkpoint response');};
 await rejects(()=>airtableWorker(rpc,fixtureProvider,fixtureStorage)(job));assert(actions.join(',')==='input,capture');
});
Deno.test('Airtable worker retry preserves provider delay and does not acknowledge capture',async()=>{
 const actions:string[]=[];const rpc:Rpc=async(_name,args)=>{actions.push(String(args.p_action));if(args.p_action==='input')return{state:'ready',phase:'capture',resource:'colors',offset:null};assert((args.p_input as {retry_after_seconds:number}).retry_after_seconds===30);return{id:job.id,state:'pending'};};
 await airtableWorker(rpc,{...fixtureProvider,page:async()=>{throw new AirtableError('AIRTABLE_RATE_LIMIT',30);}},fixtureStorage)(job);assert(actions.join(',')==='input,retry');
});
Deno.test('Airtable worker rejects duplicate records before checkpoint',async()=>{
 let fail=false;const rpc:Rpc=async(_name,args)=>{if(args.p_action==='input')return{state:'ready',phase:'capture',resource:'colors',offset:null};assert(args.p_action==='fail');fail=true;return{id:job.id,state:'dead'};};
 await airtableWorker(rpc,{...fixtureProvider,page:async()=>({records:[row(),row()],offset:null})},fixtureStorage)(job);assert(fail);
});
Deno.test('Airtable worker records missing captured media and never writes changed binary',async()=>{
 let uploads=0;const rpc:Rpc=async(_name,args)=>{if(args.p_action==='input')return{state:'ready',phase:'media',bucket:'canto-media',assets:[{asset_id:job.id,resource:'base_products',airtable_id:rec,field:'image',attachment:photo}]};assert(args.p_action==='media');const assets=(args.p_input as {assets:{status:string;error_code:string}[]}).assets;assert(assets[0].status==='failed'&&assets[0].error_code==='AIRTABLE_MEDIA_CHANGED');return{id:job.id,state:'done'};};
 await airtableWorker(rpc,{...fixtureProvider,record:async()=>row({Image:[]})},{put:async()=>{uploads++;return await fixtureStorage.put(new Uint8Array(),'',signal());}})(job);assert(uploads===0);
});
Deno.test('Airtable worker reuses database validation and apply without provider access',async()=>{
 const actions:string[]=[];let reads=0;const rpc:Rpc=async(_name,args)=>{actions.push(String(args.p_action));if(args.p_action==='input')return{state:'ready',phase:++reads===1?'validate':'apply'};return{state:args.p_action==='apply'?'done':'ready'};};
 assert((await airtableWorker(rpc,undefined,fixtureStorage)(job)).state==='done');assert(actions.join(',')==='input,validate,input,apply');
});
Deno.test('Airtable checkpoints verified first media before retrying a rate-limited second attachment',async()=>{
 const first={asset_id:job.id,resource:'base_products',airtable_id:rec,field:'image',attachment:photo},second={...first,asset_id:'22222222-2222-4222-8222-222222222222'};
 let completed=false,reads=0,uploads=0;const actions:string[]=[];
 const rpc:Rpc=async(_name,args)=>{
  actions.push(String(args.p_action));
  if(args.p_action==='input')return{state:'ready',phase:'media',bucket:'canto-media',assets:completed?[second]:[first,second]};
  if(args.p_action==='media'){
   const assets=(args.p_input as {assets:{asset_id:string}[]}).assets;assert(assets.length===1&&assets[0].asset_id===first.asset_id);completed=true;return{state:'ready'};
  }
  assert(args.p_action==='retry'&&completed);return{state:'pending'};
 };
 const p={...fixtureProvider,record:async()=>{if(++reads===2)throw new AirtableError('AIRTABLE_RATE_LIMIT',30);return row({Image:[attachment]});}};
 await airtableWorker(rpc,p,{put:async()=>{uploads++;return await fixtureStorage.put(new Uint8Array(),'',signal());}})(job);
 assert(uploads===1&&actions.join(',')==='input,media,input,retry');
});
Deno.test('Airtable fast SQL continuation can advance past ten checkpoints within the time budget',async()=>{
 let applied=0;const rpc:Rpc=async(_name,args)=>{
  if(args.p_action==='input')return{state:'ready',phase:'apply'};
  assert(args.p_action==='apply','unnecessary scheduler yield');return{state:++applied===12?'done':'ready'};
 };
 assert((await airtableWorker(rpc,undefined,fixtureStorage)(job)).state==='done');assert(applied===12);
});
