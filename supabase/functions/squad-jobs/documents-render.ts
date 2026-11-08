/** Bounded, deterministic templates. No browser, HTML, scripts or remote URLs. */
import {PDFDocument,PDFFont,PDFImage,PDFPage,rgb} from 'npm:pdf-lib@1.17.1';
import {pdfFontkit} from './fontkit-adapter.ts';
export type Data=Record<string,unknown>;
export interface Asset {bucket:'canto-media';path:string;bytes:number;content_type:string;}
export interface Snapshot extends Data {kind:'catalogue'|'delivery_challan'|'tailor_weekly';document_id:string;captured_at:string;rows:Data[];}
export class DocumentError extends Error {constructor(readonly code:'RENDER_LIMIT'|'RENDER_FAILED'|'UNSUPPORTED_MEDIA'|'STORAGE_UNAVAILABLE'){super(code);}}
export interface RenderDependencies {fonts:Uint8Array[];asset:(asset:Asset)=>Promise<Uint8Array>;}
const ink=rgb(.09,.13,.20),muted=rgb(.36,.40,.46),blue=rgb(.13,.31,.48),rule=rgb(.86,.89,.92),paper=rgb(.96,.97,.98);
const str=(x:unknown)=>x===undefined||x===null?'':String(x);
const obj=(x:unknown):Data=>x&&typeof x==='object'&&!Array.isArray(x)?x as Data:{};
const arr=(x:unknown):Data[]=>Array.isArray(x)?x as Data[]:[];
const money=(x:unknown)=>x===null||x===undefined?'Unavailable':'INR '+str(x);
export function validateAsset(value:unknown):Asset {
 const a=obj(value);
 if(a.bucket!=='canto-media'||typeof a.path!=='string'||!/^sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/.test(a.path)||a.path.slice(7,9)!==a.path.slice(10,12)||!Number.isSafeInteger(a.bytes)||Number(a.bytes)<1||Number(a.bytes)>5242880||!['image/jpeg','image/png','application/pdf','text/plain'].includes(str(a.content_type)))throw new DocumentError('UNSUPPORTED_MEDIA');
 return a as unknown as Asset;
}
export async function renderDocument(snapshot:Snapshot,deps:RenderDependencies){
 if(!['catalogue','delivery_challan','tailor_weekly'].includes(snapshot.kind)||!Array.isArray(snapshot.rows)||snapshot.rows.length>2000||!Number.isFinite(Date.parse(snapshot.captured_at)))throw new DocumentError('RENDER_LIMIT');
 const doc=await PDFDocument.create();doc.registerFontkit(pdfFontkit);
 const fonts=await Promise.all(deps.fonts.map(bytes=>doc.embedFont(bytes,{subset:true})));
 const sets=fonts.map(font=>new Set(font.getCharacterSet()));
 const title={catalogue:'Product catalogue',delivery_challan:'Delivery challan',tailor_weekly:'Weekly work and payment report'}[snapshot.kind];
 doc.setTitle(title);doc.setAuthor('Squad One');doc.setCreator('Squad One documents v1');doc.setProducer('Squad One / pdf-lib 1.17.1');doc.setCreationDate(new Date(snapshot.captured_at));doc.setModificationDate(new Date(snapshot.captured_at));
 const stamp=new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(snapshot.captured_at));
 let page!:PDFPage,y=0;const width=515,left=40,bottom=52;let sourceBytes=0;
 const widthCache=new Map<string,number>();
 function runs(text:string){
  const result:Array<{text:string;font:PDFFont;index:number}>=[];
  for(const word of text.split(/(\s+)/)){
   if(!word)continue;
   const i=sets.findIndex(set=>Array.from(word).every(c=>set.has(c.codePointAt(0)!)));
   if(i<0)throw new DocumentError('UNSUPPORTED_MEDIA');
   const prev=result.at(-1);if(prev?.index===i)prev.text+=word;else result.push({text:word,font:fonts[i],index:i});
  }return result;
 }
 function measure(text:string,size:number){const key=size+'|'+text;const prior=widthCache.get(key);if(prior!==undefined)return prior;const value=runs(text).reduce((n,r)=>n+r.font.widthOfTextAtSize(r.text,size),0);if(widthCache.size<30000)widthCache.set(key,value);return value;}
 function textAt(text:string,x:number,at:number,size=10,color=ink){for(const run of runs(text)){page.drawText(run.text,{x,y:at,font:run.font,size,color});x+=run.font.widthOfTextAtSize(run.text,size);}}
 function lines(text:string,maxWidth:number,size:number){
  const result:string[]=[];
  for(const paragraph of text.replaceAll('\r','').replaceAll('\t','    ').split('\n')){
   let line='';for(const word of paragraph.split(/\s+/)){
    if(!word)continue;
    if(measure((line?line+' ':'')+word,size)<=maxWidth){line+=(line?' ':'')+word;continue;}
    if(line){result.push(line);line='';}
    if(measure(word,size)<=maxWidth){line=word;continue;}
    for(const char of word){if(measure(line+char,size)>maxWidth){result.push(line);line='';}line+=char;}
   }result.push(line);
  }return result;
 }
 function newPage(){
  if(doc.getPageCount()>=5000)throw new DocumentError('RENDER_LIMIT');
  page=doc.addPage([595.28,841.89]);page.drawRectangle({x:0,y:783,width:595.28,height:59,color:ink});
  textAt('SQUAD ONE',left,812,10,rgb(.8,.85,.9));textAt(title,left,794,16,rgb(1,1,1));
  textAt(stamp+' IST',left,765,8,muted);y=740;
 }
 function ensure(height:number){if(y-height<bottom)newPage();}
 function paragraph(value:unknown,size=10,color=ink,indent=0,maxWidth=width){
  for(const line of lines(str(value),maxWidth,size)){ensure(size+5);textAt(line,left+indent,y,size,color);y-=size+5;}
 }
 function heading(value:unknown){ensure(45);y-=10;paragraph(value,13,blue);y-=5;}
 function pair(label:string,value:unknown){paragraph(label+': '+str(value));}
 const imageCache=new Map<string,PDFImage|null>();const warnings=new Set<string>();
 async function image(value:unknown){
  if(!value)return null;const a=validateAsset(value);if(imageCache.has(a.path))return imageCache.get(a.path)!;
  if(!a.content_type.startsWith('image/'))throw new DocumentError('UNSUPPORTED_MEDIA');
  sourceBytes+=a.bytes;if(sourceBytes>48*1024*1024)throw new DocumentError('RENDER_LIMIT');
  const bytes=await deps.asset(a);if(bytes.length!==a.bytes)throw new DocumentError('STORAGE_UNAVAILABLE');
  // PNG inflation is bounded before invoking the decoder; JPEG is embedded raw.
  if(a.content_type==='image/png'){
   if(bytes.length<24)throw new DocumentError('UNSUPPORTED_MEDIA');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
   const w=view.getUint32(16),h=view.getUint32(20);if(w<1||h<1||w*h>2000000)throw new DocumentError('RENDER_LIMIT');
  }
  let embedded:PDFImage;try{embedded=a.content_type==='image/png'?await doc.embedPng(bytes):await doc.embedJpg(bytes);}catch{throw new DocumentError('UNSUPPORTED_MEDIA');}
  imageCache.set(a.path,embedded);return embedded;
 }
 newPage();
 if(snapshot.kind==='catalogue'){
  const p=obj(snapshot.presentation);if(p.company_name)paragraph(p.company_name,21);if(p.company_desc)paragraph(p.company_desc,10,muted);paragraph(`${snapshot.total_rows??snapshot.rows.length} products | Prices captured ${stamp} IST`,9,muted);y-=12;
  for(const row of snapshot.rows){
   const variants=arr(row.variants).map(v=>str(v.size)+(p.display_stock?' (stock unavailable)':'')).join('  |  ');
   const description=[str(row.brand)+' / '+str(row.category),str(row.color),`From ${money(row.display_price)}   MRP ${money(row.mrp)}`];
   const nameLines=lines(str(row.name),width-176,14);const metaLines=description.flatMap(x=>lines(x,width-176,10));
   const variantLines=lines('Sizes: '+variants,width-20,9);const height=Math.max(160,25+nameLines.length*19+metaLines.length*15)+variantLines.length*14+30;
   if(height>680)throw new DocumentError('RENDER_LIMIT');ensure(height);
   const top=y;page.drawRectangle({x:left,y:top-height+10,width,height:height-8,color:paper,borderColor:rule,borderWidth:.5});
   y=top-23;for(const line of nameLines){textAt(line,left+12,y,14);y-=19;}y-=5;
   for(const line of metaLines){textAt(line,left+12,y,10);y-=15;}
   if(row.missing_price){textAt('Some sizes have no price',left+12,y,9,muted);y-=14;}
   const img=await image(row.image);if(img){const scaled=img.scaleToFit(145,140);page.drawImage(img,{x:left+width-158+(145-scaled.width)/2,y:top-153+(140-scaled.height)/2,width:scaled.width,height:scaled.height});}
   else{warnings.add('missing_product_image');textAt('Image unavailable',left+width-148,top-85,9,muted);}
   y=top-Math.max(160,25+nameLines.length*19+metaLines.length*15)-10;
   for(const line of variantLines){textAt(line,left+12,y,9);y-=14;}y=top-height-6;
  }
  if(p.display_stock){heading('Stock');paragraph('Stock availability is unavailable until the warehouse snapshot is reconciled. No unavailable value is treated as zero.');warnings.add('stock_unavailable');}
  if(p.bank_details){heading('Bank details');pair('Account holder',p.full_name);pair('Account number',p.account_no);pair('IFSC',p.ifsc);}
  if(p.display_address){heading('Address');paragraph(p.building_name);paragraph(p.area);}
  if(p.remarks){heading('Remarks');paragraph(p.remarks);}
  if(p.terms){heading('Terms and conditions');paragraph(p.terms);}
 }else if(snapshot.kind==='delivery_challan'){
  pair('Order',snapshot.order_id);pair('Job sheet',snapshot.item_id);pair('Dispatch',snapshot.dispatch_id);pair('Dispatched at',snapshot.dispatched_at);
  heading('Product');const product=obj(snapshot.product);pair('Name',product.name||'Unavailable');pair('Base product',product.base_product||'Unavailable');const productImage=await image(product.image);if(productImage){ensure(165);const scaled=productImage.scaleToFit(180,150);page.drawImage(productImage,{x:left,y:y-scaled.height,width:scaled.width,height:scaled.height});y-=scaled.height+15;}else paragraph('Image unavailable',9,muted);
  heading('Customer');const customer=obj(snapshot.customer);paragraph(customer.name,14);if(customer.company&&customer.company!==customer.name)paragraph(customer.company);pair('Phone',customer.phone);pair('GST',customer.gst_no);
  heading('Destination');const destination=obj(snapshot.destination);pair('Mode',destination.mode);const address=obj(destination.address);for(const key of ['address','city','state','zip_code'])if(address[key])paragraph(address[key]);
  if(snapshot.destination_basis==='current_order_only')paragraph('Historical destination was not recorded; this is the current order destination.',9,muted);
  heading('Selected dispatch quantities');for(const row of snapshot.rows){pair(str(row.size),row.quantity);}
  heading('Amounts');pair('Quantity in this dispatch',snapshot.quantity);pair('Unit price',money(snapshot.unit_price));for(const key of ['subtotal','cgst','sgst','igst','total'])pair(key.toUpperCase(),money(snapshot[key]));
  paragraph('Amounts use the item values captured for this document. This challan is not a tax invoice.',9,muted);
 }else{
  pair('Tailor',str(snapshot.tailor_name)+' ('+str(snapshot.tailor_id)+')');const period=obj(snapshot.period);pair('Week',str(period.week_start)+' to '+str(period.week_end));
  paragraph('Basis: assignment week, completed quantity at capture, current base and linked add-on OF/SN rates.',9,muted);
  for(const row of snapshot.rows){heading(str(row.product_name)+' | Job sheet '+str(row.item_id));pair('Tailor',str(row.tailor_name)+' ('+str(row.tailor_id)+')');pair('Assigned / completed / pending',`${row.assigned} / ${row.completed} / ${row.pending}`);pair('OF + SN rate',money(row.unit_rate));pair('Amount',money(row.amount));if(row.status==='needs_reconciliation')paragraph('Needs reconciliation - excluded from a reliable payable total.',9,muted);}
  heading('Summary');const total=obj(snapshot.summary);pair('Completed',total.completed);pair('Pending',total.pending);pair('Amount',money(total.amount));if(total.needs_reconciliation)paragraph('Reconciliation required. Do not use the calculated subtotal as an approved payment.');
 }
 if(snapshot.part_count&&Number(snapshot.part_index)===Number(snapshot.part_count)-1){heading('Document complete');paragraph('All parts are assembled in this document. Attached terms, if selected, are embedded in the completed PDF.',9,muted);}
 if(snapshot.terms_attachment){
  const a=validateAsset(snapshot.terms_attachment);const bytes=await deps.asset(a);if(bytes.length!==a.bytes)throw new DocumentError('STORAGE_UNAVAILABLE');
  const ext={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','text/plain':'txt'}[a.content_type]!;
  await doc.attach(bytes,'terms.'+ext,{mimeType:a.content_type,description:'Terms attached by the document requester',creationDate:new Date(snapshot.captured_at),modificationDate:new Date(snapshot.captured_at)});
  heading('Attached terms');paragraph('The original terms file is embedded as terms.'+ext+'. Use a PDF reader that supports file attachments.');
 }
 const pages=doc.getPages();pages.forEach((p,i)=>{page=p;page.drawLine({start:{x:left,y:38},end:{x:555,y:38},thickness:.5,color:rule});textAt(snapshot.document_id.slice(0,8)+' | '+str(snapshot.template_version),left,24,8,muted);textAt(`${i+1} / ${pages.length}`,510,24,8,muted);});
 const bytes=await doc.save({useObjectStreams:true,objectsPerTick:100});if(bytes.length>64*1024*1024)throw new DocumentError('RENDER_LIMIT');
 return{bytes,pages:pages.length,warnings:[...warnings]};
}
