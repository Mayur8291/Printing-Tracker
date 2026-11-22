import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer';
import {PNG} from 'pngjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),assets=path.join(root,'apps/admin/src/squad/features/studio/assets'),output=path.join(root,'output/web-studio-renderer');
await fs.mkdir(output,{recursive:true});
const registry=JSON.parse(await fs.readFile(path.join(assets,'registry.json'),'utf8'));
const html=`<!doctype html><div id="host" style="width:600px;height:600px"><canvas id="garment"></canvas></div><script type="module">import {createStudioRenderer} from '/renderer.js';window.events=[];window.runtime=createStudioRenderer({canvas:document.querySelector('canvas'),container:document.querySelector('#host'),registry:${JSON.stringify(registry)},modelUrl:'/model.glb',onEvent:e=>window.events.push(e)});</script>`;
const server=http.createServer(async(req,res)=>{const route=req.url;if(route==='/'){res.setHeader('Content-Type','text/html');res.end(html);}else if(route==='/renderer.js'||route==='/model.glb'){res.setHeader('Content-Type',route.endsWith('.js')?'text/javascript':'model/gltf-binary');res.end(await fs.readFile(route.endsWith('.js')?path.join(root,'apps/admin/src/squad/features/studio/studio-renderer.generated.js'):path.join(assets,'garment.glb')));}else{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-webgl','--ignore-gpu-blocklist']});
const errors=[],checks=[];let revision=0;
try{
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width:1000,height:900});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.runtime);
 const command=value=>page.evaluate(value=>window.runtime.command(value),value);
 const design=async value=>{await command({type:'design',revision:++revision,design:value});await page.waitForFunction(revision=>window.events.some(e=>e.type==='ready'&&e.revision===revision),{timeout:30000},revision);};
 const capture=async name=>{await command({type:'capture',revision,requestId:name});await page.waitForFunction(name=>window.events.some(e=>e.type==='capture'&&e.requestId===name),{},name);const event=await page.evaluate(name=>window.events.find(e=>e.type==='capture'&&e.requestId===name),name);const bytes=Buffer.from(event.dataUri.split(',')[1],'base64');await fs.writeFile(path.join(output,`${name}.png`),bytes);return PNG.sync.read(bytes);};
 const example=registry.supportedExample;await design(example);const first=await capture('front');assert.equal(first.width,600);assert.equal(first.height,600);checks.push('Actual model renders and captures at container size');
 await design({...example,materialColors:{...example.materialColors,BaseFabric:'#cf122b',Part_202_Fabric:'#cf122b'}});const red=await capture('red');let changed=0;for(let i=0;i<first.data.length;i+=4)if(Math.abs(first.data[i]-red.data[i])>25)changed++;assert.ok(changed>1000);checks.push('Changing fabric changes garment pixels without remount');
 await command({type:'view',view:'back'});await capture('back');checks.push('Back view captures');
 const boots=await page.evaluate(()=>window.events.filter(e=>e.type==='boot').length);await command({type:'active',active:false});await command({type:'active',active:true});await design(example);await capture('resume');assert.equal(await page.evaluate(()=>window.events.filter(e=>e.type==='boot').length),boots);checks.push('Background resume retains renderer instance');
 await page.evaluate(()=>document.querySelector('#host').style.width='340px');await page.waitForFunction(()=>document.querySelector('canvas').width===340);checks.push('Responsive container resize');
 await page.evaluate(()=>window.runtime.dispose());assert.deepEqual(errors,[]);checks.push('No browser exceptions');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks,changedPixels:changed,browser:await browser.version(),scope:'Direct web renderer; fixture design, not authenticated order flow'},null,2));console.log(JSON.stringify({checks,changedPixels:changed,output}));
}finally{await browser.close();server.close();}
