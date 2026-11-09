import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();await page.goto('http://localhost:5183',{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(async()=>{
  const {capturePreview}=await import('/src/squad/components/capturePreview.js');
  const {preparePreviewSvg}=await import('/src/squad/components/configuratorPreviewModel.js');
  document.body.innerHTML='<section class="squad-configurator-preview"><div role="img" aria-busy="false" style="position:relative;width:400px;height:400px"></div></section>';
  const section=document.querySelector('section'),frame=section.firstChild;
  const svg=preparePreviewSvg('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="#ff0000" d="M0 0H50V100H0Z"/><path fill="#0000ff" d="M50 0H100V100H50Z"/></svg>');
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  for(const mirror of [false,true]){const image=new Image();image.src=url;image.style.cssText=`position:absolute;left:${mirror?50:0}%;top:0;width:50%;height:50%;${mirror?'transform:scaleX(-1)':''}`;await image.decode();frame.append(image);}
  const file=await capturePreview(section,{size:512}),bitmap=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
  const pixel=(x,y)=>[...ctx.getImageData(x,y,1,1).data];
  const checks={mime:file.type,name:file.name,width:canvas.width,normalLeft:pixel(60,100),normalRight:pixel(180,100),mirrorLeft:pixel(320,100),mirrorRight:pixel(440,100),background:pixel(100,400),rejections:{}};
  const rejected=async(name,change,undo)=>{change();try{await capturePreview(section);checks.rejections[name]=false;}catch{checks.rejections[name]=true;}undo();};
  await rejected('pending',()=>frame.setAttribute('aria-busy','true'),()=>frame.setAttribute('aria-busy','false'));
  const warning=document.createElement('p');warning.textContent='This preview is incomplete';
  await rejected('incomplete',()=>section.append(warning),()=>warning.remove());
  const image=frame.firstChild;
  await rejected('external',()=>image.src='https://example.invalid/private.svg',()=>image.src=url);await image.decode();
  const decode=image.decode.bind(image);await rejected('changed',()=>image.decode=async()=>{await decode();image.style.top='1px';},()=>{image.decode=decode;image.style.top='0';});
  await rejected('hidden',()=>image.hidden=true,()=>image.hidden=false);
  URL.revokeObjectURL(url);return checks;
 });
 assert.equal(result.mime,'image/png');assert.equal(result.name,'design-mockup.png');assert.deepEqual(result.normalLeft,[255,0,0,255]);assert.deepEqual(result.normalRight,[0,0,255,255]);assert.deepEqual(result.mirrorLeft,[0,0,255,255]);assert.deepEqual(result.mirrorRight,[255,0,0,255]);assert.deepEqual(result.background,[255,255,255,255]);assert(Object.values(result.rejections).every(Boolean));console.log(JSON.stringify(result));
}finally{await browser.close();}
