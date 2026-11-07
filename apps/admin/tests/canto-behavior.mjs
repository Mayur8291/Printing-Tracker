import puppeteer from 'puppeteer';import fs from 'node:fs';
const state=JSON.parse(fs.readFileSync('tools/canto-sync/private/browser-state.json'));
state.local['canto:admin-target:v1']=JSON.stringify({source:'supabase',environment:'staging'});
state.local['scott-dashboard-env-override']='staging';
const b=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',protocolTimeout:900000});const p=await b.newPage();await p.setViewport({width:1440,height:1100});const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.evaluateOnNewDocument(state=>{for(const[k,v]of Object.entries(state.local))localStorage.setItem(k,v);},state);await p.goto('http://127.0.0.1:5173');await new Promise(r=>setTimeout(r,2000));
const legacy=[];p.on('request',req=>{if(req.url().includes('functions/v1/scott-dashboard-masters'))legacy.push(req.method());});
const results=await p.evaluate(async()=>{
 const{getMastersService}=await import('/src/scott/data/masterConfigs.js');const{cantoRpc,getCantoClient}=await import('/src/canto/target.js');
 const s=getMastersService('authorized_brands');const results=[];
 const assert=(v,message)=>{if(!v)throw Error(message);};
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk9sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
 const form={name:'Canto upload '+crypto.randomUUID().slice(0,8),status:'active',sort_order:0,logoFile:new File([png],'test.png',{type:'image/png'})};
 const created=await s.create(form);assert(created.logo_url?.includes('scvojtvgnkmbupvyslmb.supabase.co/storage/v1/object/public/canto-masters/'),'Wrong upload target');
 const media=await fetch(created.logo_url);assert(media.ok,'Upload cannot be read');results.push('selected-project upload and public image read');
 const updated=await s.update(created.id,{description:'After upload'},created);assert(updated.logo_url===created.logo_url,'Unchanged media lost');results.push('image retained during normal edits');
 try{await s.update(created.id,{description:'stale'},created);throw Error('Stale update accepted');}catch(e){assert(e.message.includes('changed'),'Unexpected stale-update result: '+e.message);}results.push('stale edit rejected');
 const cleared=await s.update(created.id,{logo_url:null},updated);assert(!cleared.logo_url,'Image removal failed');results.push('explicit image removal');await s.bulkDelete([created.id]);
 const path=new URL(created.logo_url).pathname.split('/canto-masters/')[1];await getCantoClient('staging').storage.from('canto-masters').remove([path]);
 const part=getMastersService('parts');const addon=(await getMastersService('add_ons').listPage({pageSize:1})).data[0];
 const pform={name:'Canto relation '+crypto.randomUUID().slice(0,8),status:'active',sort_position:0,order_criteria:false};
 const related=await part.create(pform,[{action:'update_add_ons',ids:[addon.id]}]);
 let raw=await cantoRpc('masters',{resource:'parts',action:'get',payload:{id:related.id}});assert(raw.add_ons.some(x=>String(x.id)===addon.id),'Relation did not save');
 await part.updateRelation('update_add_ons',related.id,[]);raw=await cantoRpc('masters',{resource:'parts',action:'get',payload:{id:related.id}});assert(raw.add_ons.length===0,'Relation did not clear');results.push('relation create and clear');
 try{await part.create({...pform,name:pform.name+' invalid'},[{action:'update_add_ons',ids:['9999999999']}]);throw Error('Bad relation accepted');}catch(e){assert(e.message.includes('does not exist'),'Unexpected FK result: '+e.message);}
 const absent=await part.listPage({search:pform.name+' invalid',includeInactive:true});assert(absent.totalCount===0,'Parent survived failed relation');results.push('parent and relation rollback together');await part.bulkDelete([related.id]);
 const access=await cantoRpc('access',{});assert(access.edit_revision!==access.synced_revision,'Edits not tracked');
 try{await cantoRpc('request_refresh',{environment:'staging',discard_revision:null});throw Error('Unconfirmed overwrite accepted');}catch(e){assert(e.message.includes('local edits'),'Unexpected edit-guard result: '+e.message);}results.push('refresh rejects unconfirmed edits');
 try{await cantoRpc('request_refresh',{environment:'production',discard_revision:access.edit_revision});throw Error('Cross-environment request accepted');}catch(e){assert(e.message.includes('Environment mismatch'),'Unexpected environment result: '+e.message);}results.push('cross-environment refresh rejected');
 return results;
});console.log(JSON.stringify({results,errors,legacyRequestsDuringSupabaseCrud:legacy.length}));fs.writeFileSync('tools/canto-sync/private/deep-acceptance.json',JSON.stringify({results,errors,legacyRequestsDuringSupabaseCrud:legacy.length}),{mode:0o600});await b.close();

if(errors.length || legacy.length)process.exitCode=1;
