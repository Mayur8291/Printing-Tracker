import puppeteer from 'puppeteer';import fs from 'node:fs';
const state=JSON.parse(fs.readFileSync('tools/canto-sync/private/browser-state.json'));
state.local['canto:admin-target:v1']=JSON.stringify({source:'supabase',environment:'staging'});
state.local['scott-dashboard-env-override']='staging';
const b=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',protocolTimeout:900000});const p=await b.newPage();await p.setViewport({width:1440,height:1100});const errors=[];p.on('pageerror',e=>errors.push(e.message));
try{
await p.evaluateOnNewDocument(state=>{for(const[k,v]of Object.entries(state.local))localStorage.setItem(k,v);},state);await p.goto('http://127.0.0.1:5173');await p.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.innerText==='Masters'),{timeout:60000});await p.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText==='Masters').click());
const labels=await p.evaluate(async()=>{const{MASTER_CONFIG_LIST}=await import('/src/scott/data/masterConfigs.js');return MASTER_CONFIG_LIST.map(c=>({key:c.key,label:c.label}));});
const result=[];
for(const config of labels){
 await p.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.innerText===label),{},config.label);
 await p.evaluate(label=>[...document.querySelectorAll('button')].find(b=>b.innerText===label).click(),config.label);
 await p.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.startsWith('New ')&&!b.disabled),{timeout:60000});
 await p.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('New ')&&!b.disabled).click());await p.waitForSelector('[role=dialog]');await new Promise(r=>setTimeout(r,500));
 result.push({resource:config.key,dialog:await p.$eval('[role=dialog]',e=>({inputs:e.querySelectorAll('input,textarea,[role=combobox]').length,alerts:[...e.querySelectorAll('[role=alert]')].map(a=>a.textContent)}))});
 await p.keyboard.press('Escape');await p.waitForSelector('[role=dialog]',{hidden:true});
}
console.log(JSON.stringify({result,errors}));fs.writeFileSync('tools/canto-sync/private/dialog-acceptance.json',JSON.stringify({result,errors}),{mode:0o600});
if(errors.length)throw new Error("Browser errors occurred");
}finally{await b.close();}
