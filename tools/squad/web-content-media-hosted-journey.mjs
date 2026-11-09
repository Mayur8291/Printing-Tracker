/** Bounded read-only acceptance of existing promotion/product media. No uploads,
 * grant edits, data fixtures, provider calls, external shares or PDF generation.
 * The parent owns disposable Auth, fences and exact cleanup. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {downloadOwnedMedia} from './web-media-hosted-adapter.mjs';
import {privateDirectory,observeReadRequests,clickText,ready,capture} from './web-conditional-content-hosted-journey.mjs';
import {referenceKey} from '../../apps/admin/src/squad/components/mediaModel.js';

const ORIGIN='https://scvojtvgnkmbupvyslmb.supabase.co';
const MAX_BYTES=10*1024*1024,RASTER=new Set(['image/png','image/jpeg','image/webp','image/gif']);
const hash=data=>createHash('sha256').update(data).digest('hex');
export function usableGrant(grant,{raster=false}={}) {
 if(grant?.status!=='ready'||!Number.isSafeInteger(Number(grant.bytes))||Number(grant.bytes)<=0||Number(grant.bytes)>MAX_BYTES)return false;
 let url;try{url=new URL(grant.url);}catch{return false;}
 return url.origin===ORIGIN&&url.pathname.startsWith('/storage/v1/object/sign/')&&(!raster||RASTER.has(grant.content_type));
}
export async function discoverProducts(sdk,customerId) {
 let cursor=null,usable=null,missing=null;const observed=[];
 for(let batch=0;batch<2&&(!usable||!missing);batch++){
  const list=await sdk.readyMade({},customerId,{cursor,limit:20});
  assert.ok(list.data.length<=20);cursor=list.next_cursor;
  const rows=list.data.filter(p=>p.images?.[0]);
  const grants=rows.length?(await sdk.mediaGrants(rows.map(p=>p.images[0]))).references:[];
  const byRef=new Map(grants.map(g=>[referenceKey(g),g]));
  for(const product of rows){
   const grant=byRef.get(referenceKey(product.images[0]));
   observed.push({id:product.id,status:grant?.status??'unresolved'});
   if(!usable&&product.name&&usableGrant(grant,{raster:true}))usable={product,grant};
   if(!missing&&product.name&&grant?.status==='missing')missing={product,grant};
  }
  if(!cursor)break;
 }
 return {usable,missing,observed};
}
export async function discoverPromotions(sdk) {
 let cursor=null,usable=null,missing=null,external=null;const observed=[];
 for(let batch=0;batch<2&&(!usable||!missing);batch++){
  const list=await sdk.promotions({},{cursor,limit:12});assert.ok(list.data.length<=12);cursor=list.next_cursor;
  // The current UI identifies a resource by its displayed title, so reject an
  // ambiguous title in this page instead of silently clicking another record.
  const rows=list.data.filter(p=>p.name&&list.data.filter(other=>other.name===p.name).length===1);
  for(const item of rows){
   if(item.content?.kind==='external'&&!external)external={item,batch};
   if(item.content?.kind!=='file'||!item.content.media)continue;
   const grant=(await sdk.mediaGrants([item.content.media])).references?.[0];
   observed.push({id:item.id,status:grant?.status??'unresolved'});
   if(!usable&&usableGrant(grant))usable={item,grant,batch};
   if(!missing&&grant?.status==='missing')missing={item,grant,batch};
  }
  if(!cursor)break;
 }
 return {usable,missing,external,observed};
}
export async function discoverOwnedContent(sdk,customerId,p) {
 assert.equal(p.format,'squad-web-content-fixture/v1');assert.match(p.sha256,/^[a-f0-9]{64}$/);
 assert.ok(Number.isInteger(p.bytes)&&p.bytes>0&&p.bytes<=MAX_BYTES);
 const productList=await sdk.readyMade({search:p.product_name},customerId,{limit:20});
 const product=productList.data.find(row=>row.id===p.class_id);assert.ok(product);assert.equal(product.name,p.product_name);
 const productGrant=(await sdk.mediaGrants([product.images[0]])).references[0];assert.ok(usableGrant(productGrant,{raster:true}));
 const list=await sdk.promotions({category:p.category,upload_date:p.upload_date},{limit:12});
 assert.equal(list.next_cursor,null);assert.deepEqual(list.data.map(row=>row.id).sort(),[p.ready_id,p.missing_id].sort());
 const readyItem=list.data.find(row=>row.id===p.ready_id),missingItem=list.data.find(row=>row.id===p.missing_id);
 assert.equal(readyItem.name,p.ready_name);assert.equal(missingItem.name,p.missing_name);
 const grants=(await sdk.mediaGrants([readyItem.content.media,missingItem.content.media])).references;
 const byRef=new Map(grants.map(g=>[referenceKey(g),g]));
 const readyGrant=byRef.get(referenceKey(readyItem.content.media)),missingGrant=byRef.get(referenceKey(missingItem.content.media));
 assert.ok(usableGrant(readyGrant));assert.equal(missingGrant.status,'missing');
 return {products:{usable:{product,grant:productGrant},missing:null,observed:[{id:product.id,status:'ready'}]},
  promotions:{usable:{item:readyItem,grant:readyGrant,batch:0,uploadDate:p.upload_date,category:p.category},missing:{item:missingItem,grant:missingGrant,batch:0,uploadDate:p.upload_date,category:p.category},external:null,observed:list.data.map(row=>({id:row.id,status:row.id===p.ready_id?'ready':'missing'}))}};
}
async function expectedBytes(page,grant) {
 assert.ok(usableGrant(grant));
 const proof=await page.evaluate(async({url,max})=>{
  const response=await fetch(url,{credentials:'omit',redirect:'error'});if(!response.ok||!response.body)throw Error('Source media download failed');
  const reader=response.body.getReader();let size=0;const chunks=[];
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>max)throw Error('Source media exceeds acceptance bound');chunks.push(chunk.value);}}catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return {bytes:size,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('')};
 },{url:grant.url,max:MAX_BYTES});
 assert.equal(proof.bytes,Number(grant.bytes));return proof;
}
async function findProduct(page,ctx,product) {
 await page.goto(ctx.base+'/squad/catalogue?type=ready-made',{waitUntil:'domcontentloaded'});await page.waitForSelector('input[aria-label="Search products"]');
 await page.type('input[aria-label="Search products"]',product.name);await page.click('button[aria-label="Search"]');
 await page.waitForFunction(id=>[...document.querySelectorAll('main article')].some(n=>[...n.querySelectorAll('span')].some(s=>s.textContent.trim()===`#${id}`)),{timeout:30000},product.id);
 return page.evaluateHandle(id=>[...document.querySelectorAll('main article')].find(n=>[...n.querySelectorAll('span')].some(s=>s.textContent.trim()===`#${id}`)),product.id);
}
async function downloadZip(page,directory,proof,product) {
 const cdp=await page.browser().target().createCDPSession(),contextId=page.browserContext().id;
 const pageCdp=await page.createCDPSession();let frameId;
 try{frameId=(await pageCdp.send('Page.getFrameTree')).frameTree.frame.id;}finally{await pageCdp.detach();}
 let timer,guid,downloaded=false;
 const completed=new Promise((resolve,reject)=>{
  timer=setTimeout(()=>reject(Error('Product ZIP download did not complete')),30000);
  cdp.on('Browser.downloadWillBegin',event=>{if(event.frameId===frameId&&event.suggestedFilename==='product-images.zip')guid=event.guid;});
  cdp.on('Browser.downloadProgress',event=>{if(event.guid===guid&&event.state==='completed')resolve(guid);else if(event.guid===guid&&event.state==='canceled')reject(Error('Product ZIP download cancelled'));});
 });completed.catch(()=>{});
 try{
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:directory,eventsEnabled:true,...contextId?{browserContextId:contextId}:{}});
  await page.click('a[download="product-images.zip"]');
  const id=await completed;assert.match(id,/^[a-zA-Z0-9-]+$/);const filename=path.join(directory,id);fs.chmodSync(filename,0o600);
  const bytes=fs.readFileSync(filename);assert.ok(bytes.length<MAX_BYTES+100000);const zip=await JSZip.loadAsync(bytes);
  const names=Object.keys(zip.files);assert.equal(names.length,2);assert.ok(names.includes('products.txt'));
  const imageName=names.find(n=>n!=='products.txt');assert.ok(!imageName.includes('/')&&!imageName.includes('..'));
  const image=await zip.file(imageName).async('nodebuffer');assert.equal(image.length,proof.bytes);assert.equal(hash(image),proof.sha256);
  const manifest=await zip.file('products.txt').async('string');assert.ok(manifest.includes(`Product #${product.id}`));assert.ok(!/https?:|token=|stock|price/i.test(manifest.replace(product.name,'')));
  fs.unlinkSync(filename);downloaded=true;return {downloaded:true,imageBytes:image.length,imageSha256:proof.sha256,flatFiles:2,noSignedUrls:true};
 }finally{
  clearTimeout(timer);
  if(guid&&!downloaded&&/^[a-zA-Z0-9-]+$/.test(guid)){
   await cdp.send('Browser.cancelDownload',{guid,...contextId?{browserContextId:contextId}:{}}).catch(()=>{});
   for(const basename of [guid,`${guid}.crdownload`]){const owned=path.join(directory,basename);if(fs.existsSync(owned))fs.unlinkSync(owned);}
  }
  await cdp.send('Browser.setDownloadBehavior',{behavior:'default',...contextId?{browserContextId:contextId}:{}}).catch(()=>{});await cdp.detach();
 }
}
export async function applyOwnedPromotionFilters(page,candidate,{origin=ORIGIN}={}) {
 assert.equal(typeof candidate.category,'string');assert.match(candidate.uploadDate,/^\d{4}-\d{2}-\d{2}$/);
 for(let pageIndex=0;pageIndex<10;pageIndex++){
  await page.waitForFunction(()=>{const s=document.querySelector('main form select');return s&&!s.disabled;});
  if(await page.$eval('main form select',(s,value)=>[...s.options].some(o=>o.value===value),candidate.category))break;
  assert.ok(pageIndex<9,'Owned category not found within ten bounded category pages');
  const before=await page.$eval('main form select',s=>[...s.options].map(o=>o.value).join('\n'));
  const more=await page.evaluateHandle(()=>[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()==='More categories'&&!b.disabled));
  assert.ok(more.asElement(),'Owned category missing from category list');
  try{await more.asElement().click();}finally{await more.dispose();}
  await page.waitForFunction(before=>{const s=document.querySelector('main form select');return s&&!s.disabled&&[...s.options].map(o=>o.value).join('\n')!==before;},{},before);
 }
 await page.select('main form select',candidate.category);
 await page.$eval('input[type=date]',(node,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},candidate.uploadDate);
 const received=page.waitForResponse(response=>{if(response.request().method()!=='POST'||new URL(response.url()).origin!==origin||new URL(response.url()).pathname!=='/rest/v1/rpc/v1_promotions_list')return false;let body;try{body=JSON.parse(response.request().postData());}catch{return false;}return body.p_filters?.category===candidate.category&&body.p_filters?.upload_date===candidate.uploadDate;});received.catch(()=>{});
 await clickText(page,'Apply filters');const response=await received;assert.equal(response.ok(),true);return response.json();
}
async function promotionCard(page,ctx,candidate) {
 await page.goto(ctx.base+'/squad/promotions',{waitUntil:'domcontentloaded'});await ready(page);
 if(candidate.category){const filtered=await applyOwnedPromotionFilters(page,candidate);assert.ok(filtered.data.some(row=>row.id===candidate.item.id));}
 for(let index=0;index<candidate.batch;index++){await clickText(page,'Next');await ready(page);}
 await page.waitForFunction(name=>[...document.querySelectorAll('main section')].some(n=>n.querySelector('h2')?.textContent===name),{timeout:30000},candidate.item.name);
 return page.evaluateHandle(name=>[...document.querySelectorAll('main section')].find(n=>n.querySelector('h2')?.textContent===name),candidate.item.name);
}
async function missingState(page,handle) {
 await page.waitForFunction(node=>node.textContent.includes('File missing from source'),{timeout:15000},handle);
 await handle.evaluate(node=>{if(!node.textContent.includes('File missing from source'))throw Error('Missing media lacks explicit source status');if([...node.querySelectorAll('.squad-media button,.squad-media a')].some(n=>n.textContent.trim()==='Download'||n.textContent.trim()==='Open'))throw Error('Missing file exposes a download or open action');});
}

/** Verify the real Share click at the clipboard capability boundary. This
 * deliberately does not read/overwrite the user's OS clipboard or send a URL. */
export async function promotionClipboardFallback(page,card,expectedUrl){
 await page.evaluate(()=>{
  if(window.__squadClipboardBoundary)throw Error('Clipboard boundary already active');
  const state={share:Object.getOwnPropertyDescriptor(navigator,'share'),clipboard:Object.getOwnPropertyDescriptor(navigator,'clipboard'),values:[]};
  window.__squadClipboardBoundary=state;
  Object.defineProperty(navigator,'share',{configurable:true,value:undefined});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>state.values.push(value)}});
 });
 try{
  const button=await card.asElement().$('button[aria-label^="Share "]');assert.ok(button);try{await button.click();}finally{await button.dispose();}
  await page.waitForFunction(()=>[...document.querySelectorAll('[role=status]')].some(n=>n.textContent==='Link copied.'));
  const valid=await page.evaluate(url=>window.__squadClipboardBoundary.values.length===1&&window.__squadClipboardBoundary.values[0]===url,expectedUrl);
  assert.equal(valid,true,'Share must copy the exact authorized promotion URL');
  return {clicked:true,exactAuthorizedUrl:true,applicationClipboardBoundary:true,osClipboardWritten:false,nativeShareSent:false};
 }finally{
  await page.evaluate(()=>{const s=window.__squadClipboardBoundary;if(!s)return;for(const key of ['share','clipboard']){if(s[key])Object.defineProperty(navigator,key,s[key]);else delete navigator[key];}delete window.__squadClipboardBoundary;});
 }
}

export async function runJourney(ctx) {
 const entry=(ctx.clientsMap??ctx.clients).get(3);assert.ok(entry?.sdk);const me=await entry.sdk.me();assert.equal(me.id,String(ctx.fixture.actors['3']));assert.equal(me.capabilities.catalogue,true);assert.equal(me.capabilities.promotions,true);
 const obtained=await ctx.pageFor(3),page=obtained.page??obtained,directory=privateDirectory(ctx,'web-content-media'),guard=observeReadRequests(page,ctx.base);
 const report={checks:[],coverage:{},screenshotsPrivate:true,scope:'Bounded existing-source media through actual Customer UI; no upload, grant mutation, provider, external share or generated PDF'};
 try{
  await page.setViewport({width:1440,height:1000});await page.goto(ctx.base+'/squad/home',{waitUntil:'domcontentloaded'});await ready(page);
  const owned=ctx.ownedContent?await discoverOwnedContent(entry.sdk,me.id,ctx.ownedContent):null;
  const products=owned?.products??await discoverProducts(entry.sdk,me.id);report.productsObserved=products.observed;
  if(owned)report.scope='Exact-owned ready PNG and missing promotion fixture through read-only Customer UI; parent independently verifies cleanup';
  if(products.usable){
   const {product,grant}=products.usable,proof=await expectedBytes(page,grant);
   if(owned)assert.deepEqual(proof,{bytes:ctx.ownedContent.bytes,sha256:ctx.ownedContent.sha256});
   let card=await findProduct(page,ctx,product);const checkbox=await card.asElement().$('input[type=checkbox]');assert.ok(checkbox);await checkbox.click();await checkbox.dispose();await card.dispose();
   await clickText(page,'Review and share');await page.waitForSelector('[role=dialog]');
   await clickText(page,'Prepare images','[role=dialog]');await page.waitForFunction(()=>document.querySelector('[role=dialog]')?.textContent.includes('1 image ready'),{timeout:30000});
   report.coverage.productZip=await downloadZip(page,directory,proof,product);report.productId=product.id;
   await page.setViewport({width:360,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   report.productScreenshot=await capture(page,directory,'product-zip-mobile');await clickText(page,'Close','[role=dialog]');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
   report.checks.push('actual_checkbox_prepare_and_zip_click','downloaded_zip_original_image_exact_bytes','flat_name_manifest_without_signed_urls','product_share_mobile_bounds');
   report.coverage.nativeFileShare='Not invoked: operating-system share targets remain outside this headless read-only journey';
  }else report.coverage.productZip='No ready raster <=10MB in the first40 accessible ready-made products';
  if(products.missing){
   const card=await findProduct(page,ctx,products.missing.product);await ready(page);await missingState(page,card);
   const checkbox=await card.asElement().$('input[type=checkbox]');assert.ok(checkbox);await checkbox.click();await checkbox.dispose();await card.dispose();
   await clickText(page,'Review and share');await clickText(page,'Prepare images','[role=dialog]');
   await page.waitForFunction(()=>document.querySelector('[role=dialog]')?.textContent.includes('0 images ready'),{timeout:30000});
   assert.equal(await page.$eval('[role=dialog]',n=>n.textContent.includes('Image is missing from this environment.')),true);assert.equal(await page.$('a[download="product-images.zip"]'),null);
   report.coverage.productMissing=true;report.missingProductScreenshot=await capture(page,directory,'product-missing-mobile');await clickText(page,'Close','[role=dialog]');report.checks.push('missing_product_explicitly_excluded_without_empty_download');
  }else report.coverage.productMissing='No missing image reference in the first40 accessible ready-made products';
  const promotions=owned?.promotions??await discoverPromotions(entry.sdk);report.promotionsObserved=promotions.observed;
  if(promotions.usable){
   const proof=await expectedBytes(page,promotions.usable.grant);if(owned)assert.deepEqual(proof,{bytes:ctx.ownedContent.bytes,sha256:ctx.ownedContent.sha256});const card=await promotionCard(page,ctx,promotions.usable);await ready(page);
   const viewer=await card.asElement().$('.squad-media:not(.squad-media-compact)');assert.ok(viewer);
   try{report.coverage.promotionDownload=await downloadOwnedMedia(page,viewer,directory,proof);}finally{await viewer.dispose();await card.dispose();}
   report.promotionId=promotions.usable.item.id;
   const visibleCard=await promotionCard(page,ctx,promotions.usable);await visibleCard.evaluate(n=>n.scrollIntoView({block:'center'}));await visibleCard.dispose();
   report.promotionScreenshot=await capture(page,directory,'promotion-mobile');report.checks.push('actual_promotion_fresh_grant_download_exact_bytes');
  }else report.coverage.promotionDownload='No ready attachment <=10MB in the first24 accessible promotions';
  if(promotions.missing){const card=await promotionCard(page,ctx,promotions.missing);await ready(page);await missingState(page,card);await card.dispose();report.coverage.promotionMissing=true;report.missingPromotionScreenshot=await capture(page,directory,'promotion-missing-mobile');report.checks.push('missing_promotion_explicit_without_download');}
  else report.coverage.promotionMissing='No missing attachment in the first24 accessible promotions';
  if(promotions.external){const card=await promotionCard(page,ctx,promotions.external);const link=await card.asElement().$('a[target="_blank"]');assert.ok(link);const attrs=await link.evaluate(n=>({href:n.href,rel:n.rel}));assert.ok(/^https?:/.test(attrs.href));assert.ok(attrs.rel.includes('noopener')&&attrs.rel.includes('noreferrer'));report.coverage.externalPromotion=await promotionClipboardFallback(page,card,attrs.href);report.checks.push('external_promotion_actual_share_click_exact_clipboard_fallback_boundary');await link.dispose();await card.dispose();}
  assert.deepEqual(guard.denied,[],'Content journey must remain read-only and staging-only');
  report.checks.push('no_application_mutation_or_cross_environment_transport');
  report.completeRequiredMedia=Boolean(report.coverage.productZip?.downloaded&&(owned||report.coverage.productMissing===true)&&report.coverage.promotionDownload?.downloaded&&report.coverage.promotionMissing===true);
  if(owned){
   // A new grant and actual bytes immediately before the parent handoff; no URL is persisted.
   const fresh=(await entry.sdk.mediaGrants([promotions.usable.item.content.media])).references[0];const proof=await expectedBytes(page,fresh);
   assert.deepEqual(proof,{bytes:ctx.ownedContent.bytes,sha256:ctx.ownedContent.sha256});
   report.nativeOracle={freshCustomerGrantVerified:true,customerId:me.id,promotionId:ctx.ownedContent.ready_id,promotionName:ctx.ownedContent.ready_name,category:ctx.ownedContent.category,uploadDate:ctx.ownedContent.upload_date,productId:ctx.ownedContent.class_id,productName:ctx.ownedContent.product_name,filename:ctx.ownedContent.sha256,...proof};
  }
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});return report;
 }finally{guard.close();}
}
