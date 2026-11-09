/** Production artifact payload/lazy-boundary and anonymous rendering lab.
 * No fixture credentials, hosted API calls, application writes or analytics.
 * Local throttled samples are not deployed/field p75 Core Web Vitals evidence. */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {parseAst} from 'rollup/parseAst';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),dist=path.join(root,'apps/admin/dist');
const html=await fs.readFile(path.join(dist,'index.html'),'utf8'),entry=html.match(/<script[^>]+src="([^"]+)"/)[1];
const css=[...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(m=>m[1]);
const cache=new Map();
async function moduleInfo(file){
 if(cache.has(file))return cache.get(file);const content=await fs.readFile(file),ast=parseAst(content.toString()),imports=[],dynamic=[];
 const stack=[ast];while(stack.length){const n=stack.pop();if(!n||typeof n!=='object')continue;
  if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(n.type)&&n.source)imports.push(n.source.value);
  if(n.type==='ImportExpression'&&n.source?.type==='Literal')dynamic.push(n.source.value);
  for(const value of Object.values(n))if(Array.isArray(value))stack.push(...value);else if(value&&typeof value==='object')stack.push(value);
 }
 const info={file:path.relative(dist,file),bytes:content.length,gzip:gzipSync(content).length,sha256:createHash('sha256').update(content).digest('hex'),imports,dynamic};cache.set(file,info);return info;
}
async function closure(start){const visited=new Set(),pending=[start];while(pending.length){const file=pending.pop();if(visited.has(file))continue;visited.add(file);const info=await moduleInfo(file);for(const spec of info.imports){assert.ok(spec.startsWith('.'),'Unexpected bare production import');pending.push(path.resolve(path.dirname(file),spec));}}return visited;}
const initial=await closure(path.join(dist,entry)),initialFiles=await Promise.all([...initial].map(moduleInfo));
const features=['SquadApp','CataloguePage','OrdersPage','PeoplePage','ProductionPage','StockPage','JobWorkPage','WorkPage','TargetsPage','ReportsPage','DocumentsPage','PromotionsPage','AdministrationPage'];
const assets=await fs.readdir(path.join(dist,'assets')),chunks=[];
for(const name of features){const file=assets.find(n=>n.startsWith(name+'-')&&n.endsWith('.js'));assert.ok(file,`Missing lazy feature ${name}`);const absolute=path.join(dist,'assets',file);assert.equal(initial.has(absolute),false,`${name} eagerly imported by login`);const graph=await closure(absolute);chunks.push({name,entry:file,incrementalModules:[...graph].filter(f=>!initial.has(f)).map(f=>path.relative(dist,f)),incrementalGzip:(await Promise.all([...graph].filter(f=>!initial.has(f)).map(moduleInfo))).reduce((n,f)=>n+f.gzip,0)});}
assert.equal(initialFiles.some(f=>/\/App-[^/]+\.js$/.test(f.file)),false,'Legacy Tracker loaded in anonymous Squad entry');
const styles=await Promise.all(css.map(async f=>{const bytes=await fs.readFile(path.join(dist,f));return{file:f,bytes:bytes.length,gzip:gzipSync(bytes).length};}));
const report={scope:'Production artifact; anonymous local Chrome lab, not deployed/field performance acceptance',build:{entry,initialJS:initialFiles,styles,initialGzip:initialFiles.reduce((n,f)=>n+f.gzip,0)+styles.reduce((n,f)=>n+f.gzip,0),lazyFeatures:chunks},samples:[],externalRequests:[],errors:[]};
const server=http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(dist,'.'+pathname);assert.ok(file.startsWith(dist+path.sep)||file===dist);let selected=file;if(!path.extname(pathname))selected=path.join(dist,'index.html');const body=await fs.readFile(selected);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(selected)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Encoding','gzip');res.end(gzipSync(body));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const vitalSource=await fs.readFile('/tmp/squad-web-vitals-6.2.3/node_modules/web-vitals/dist/web-vitals.iife.js','utf8');
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{for(const width of [360,1366])for(let iteration=1;iteration<=3;iteration++){
 const context=await browser.createBrowserContext(),page=await context.newPage();try{
  await page.setViewport({width,height:844});await page.setCacheEnabled(false);const cdp=await page.createCDPSession();await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});
  await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(u.origin!==base&&!['data:','blob:'].includes(u.protocol)){report.externalRequests.push({origin:u.origin,path:u.pathname});void r.abort();}else void r.continue();});page.on('pageerror',e=>report.errors.push(e.message));
  await page.evaluateOnNewDocument(vitalSource+';window.__squadLabVitals={};for(const name of ["CLS","INP","LCP","FCP","TTFB"]){webVitals["on"+name](m=>{window.__squadLabVitals[m.name]={value:m.value,rating:m.rating,navigationType:m.navigationType};},{reportAllChanges:true});}');
  const start=performance.now();await page.goto(base+'/squad/home',{waitUntil:'networkidle0'});await page.waitForSelector('#login-email');
  const useful=performance.now()-start;await page.type('#login-email','local@example.invalid');const toggle=await page.$('button[aria-label="Show password"]');if(toggle)await toggle.click();await new Promise(r=>setTimeout(r,600));
  const state=await page.evaluate(()=>({vitals:window.__squadLabVitals,resources:performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,transferSize:r.transferSize,encodedBodySize:r.encodedBodySize,duration:r.duration})),overflow:document.documentElement.scrollWidth>innerWidth}));
  assert.equal(state.overflow,false);assert.ok(!state.resources.some(r=>/\/(?:App|SquadApp|CataloguePage|OrdersPage)-[^/]+\.js$/.test(r.path)),'Anonymous page fetched unrelated lazy application');
  report.samples.push({width,iteration,usefulRenderUpperBoundMs:Math.round(useful),...state});if(iteration===1)await page.screenshot({path:`/tmp/squad-production-login-${width}.png`});
 }finally{await context.close();}
}assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.labProfile={browser:await browser.version(),cpuSlowdown:4,latencyMs:150,downloadBytesPerSecond:200000,uploadBytesPerSecond:93750,cache:'disabled; new isolated context each sample',webVitals:'6.2.3',fieldPercentiles:false};
await fs.writeFile('/tmp/squad-production-lab.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,initialGzip:report.build.initialGzip,lazyFeatures:chunks.length,samples:report.samples.map(({width,iteration,vitals,usefulRenderUpperBoundMs})=>({width,iteration,vitals,usefulRenderUpperBoundMs})),report:'/tmp/squad-production-lab.json'}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
