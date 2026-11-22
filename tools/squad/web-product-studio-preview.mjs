/** Loopback-only development preview of the actual web studio. Never part of production routes. */
import http from 'node:http';
import path from 'node:path';
import {createServer as createViteServer} from 'vite';
import {fixtureHtml,previewFixtureHtml,loadStudioFixtures} from './studio-fixture-page.mjs';
const port=Number(process.env.STUDIO_PREVIEW_PORT??5198),host='127.0.0.1';
const {catalogue,assets,fixtureSource}=await loadStudioFixtures();
const server=http.createServer();
const adminRoot=path.resolve('apps/admin');process.chdir(adminRoot);
const vite=await createViteServer({configFile:path.join(adminRoot,'vite.config.js'),root:adminRoot,server:{middlewareMode:true,hmr:{server,host}},appType:'custom'});
server.on('request',(req,res)=>{
 const pathname=new URL(req.url,'http://'+host).pathname;
 if(pathname==='/'||pathname==='/studio-preview'||pathname==='/__studio-review'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' ws://127.0.0.1:* blob: data:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none'"});res.end(pathname==='/__studio-review'?fixtureHtml:previewFixtureHtml());return;
 }
 if(pathname==='/__studio-fixture-api.mjs'){res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});res.end(fixtureSource);return;}
 if(pathname==='/__studio-data'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({catalogue,assets}));return;}
 vite.middlewares(req,res,()=>{res.writeHead(404);res.end('Local preview route not found');});
});
server.listen(port,host,()=>console.log(`Actual Product Studio · local sample data: http://${host}:${port}/studio-preview`));
async function close(){await vite.close();server.close();}process.on('SIGINT',close);process.on('SIGTERM',close);
