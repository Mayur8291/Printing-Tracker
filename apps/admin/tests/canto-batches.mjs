import puppeteer from 'puppeteer';import fs from 'node:fs';
const state=JSON.parse(fs.readFileSync('tools/canto-sync/private/browser-state.json'));
state.local['canto:admin-target:v1']=JSON.stringify({source:'supabase',environment:'staging'});state.local['scott-dashboard-env-override']='staging';
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();await page.evaluateOnNewDocument(state=>{for(const[k,v]of Object.entries(state.local))localStorage.setItem(k,v);},state);await page.goto('http://127.0.0.1:5173');
 const result=await page.evaluate(async()=>{
  const {getMastersService}=await import('/src/scott/data/masterConfigs.js');const {batchSave}=await import('/src/scott/bulk/bulkSaveService.js');
  const service=getMastersService('colors'),tag=crypto.randomUUID().slice(0,8);
  const created=await Promise.all(Array.from({length:6},(_,i)=>service.create({name:`Canto batch ${tag} ${i}`,hex_code:'#152535',status:'active'})));
  const updated=await batchSave({toUpdate:created.map(row=>({id:row.id,rowKey:row.id,row:{name:row.name,hex_code:'#263646',status:'active'},previous:row})),updateMutation:({id,updates,previous})=>service.update(id,updates,previous)});
  if(updated.failed||updated.updated!==6)throw Error('Parallel bulk update failed');
  const stale=await batchSave({toUpdate:[{id:created[0].id,rowKey:created[0].id,row:{hex_code:'#374757'},previous:created[0]}],updateMutation:({id,updates,previous})=>service.update(id,updates,previous)});
  if(stale.failed!==1||!stale.errors[0].error.includes('changed'))throw Error('Stale bulk edit was not rejected');
  const actual=await service.getById(created[0].id);if(actual.hex_code.toUpperCase()!=='#263646')throw Error('Stale bulk edit changed data');
  await service.bulkDelete(created.map(row=>row.id));return{parallelCreates:6,parallelBulkUpdates:6,staleBulkEditRejected:true};
 });
 fs.writeFileSync('tools/canto-sync/private/batch-acceptance.json',JSON.stringify(result),{mode:0o600});console.log(result);
}finally{await browser.close();}
