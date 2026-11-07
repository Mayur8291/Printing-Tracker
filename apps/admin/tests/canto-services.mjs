import puppeteer from 'puppeteer';import fs from 'node:fs';
const state=JSON.parse(fs.readFileSync('tools/canto-sync/private/browser-state.json'));
state.local['canto:admin-target:v1']=JSON.stringify({source:'supabase',environment:'staging'});
state.local['scott-dashboard-env-override']='staging';
const b=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const p=await b.newPage();
await p.evaluateOnNewDocument(state=>{for(const[k,v]of Object.entries(state.local))localStorage.setItem(k,v);},state);await p.goto('http://127.0.0.1:5173');await new Promise(r=>setTimeout(r,1500));
const results=await p.evaluate(async()=>{
 const {MASTER_CONFIG_LIST,getMastersService}=await import('/src/scott/data/masterConfigs.js');
 const {dialogFieldsFor,toWriteForm}=await import('/src/scott/masters/mastersDialogFields.js');
 const {planRelationWrites}=await import('/src/scott/masters/mastersRelationWrites.js');
 const result=[];
 for(const config of MASTER_CONFIG_LIST){
  const service=getMastersService(config.key);let created;
  try{
   const first=(await service.listPage({pageSize:1})).data[0]||{};
   const fields=dialogFieldsFor(config);const values={};
   for(const field of fields){
    let value=field.valueFrom?field.valueFrom(first):first[field.key];
    if(value==null)value=field.defaultValue??(field.type==='multiselect'?[]:field.type==='boolean'?false:field.type==='number'?0:'');
    if(['name','title','add_on'].includes(field.key))value='Canto acceptance '+crypto.randomUUID().slice(0,8);
    if(['image','images','image-slots'].includes(field.type))value=field.type==='image'?'':[];
    values[field.key]=value;
   }
   values.status='active';
   created=await service.create(toWriteForm(config,values),planRelationWrites(config,values));
   if(!created.id)throw Error('Create missing ID');
   const read=await service.getById(created.id);
   await service.update(created.id,toWriteForm(config,values,read),read,planRelationWrites(config,values,read));
   await service.bulkDelete([created.id]);
   result.push({resource:config.resource,success:true,id:created.id});
  }catch(e){result.push({resource:config.resource,error:e.message,id:created?.id});}
 }
 return result;
});
fs.writeFileSync('tools/canto-sync/private/service-acceptance.json',JSON.stringify(results,null,2),{mode:0o600});console.log(JSON.stringify(results,null,2));await b.close();

if(results.some(r=>r.error))process.exitCode=1;
