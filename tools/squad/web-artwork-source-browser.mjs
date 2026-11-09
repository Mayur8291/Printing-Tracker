/** Local replay of an authorized, privately retained real source asset. No
 * hosted requests or source files are embedded in the repository/report. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const filename=process.argv[2];
assert(filename,'Pass the privately retained SVG file path.');
const source=fs.readFileSync(filename,'utf8');
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const page=await browser.newPage();await page.setViewport({width:1440,height:900});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:5183',{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async source=>{
    const {preparePreviewSvg}=await import('/src/squad/components/configuratorPreviewModel.js');
    const parse=text=>new DOMParser().parseFromString(text,'image/svg+xml');
    const original=parse(source),colors=['#1969bf','#db214e'],renders=[];
    document.body.innerHTML='';document.body.style.cssText='margin:0;background:#f4f4f5;display:flex;flex-wrap:wrap;gap:24px;padding:24px';
    for(const color of colors){
      const output=preparePreviewSvg(source,color),parsed=parse(output),url=URL.createObjectURL(new Blob([output],{type:'image/svg+xml'}));
      const image=new Image();image.src=url;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=400;canvas.height=650;canvas.style.cssText='background:white;border:1px solid #ddd;border-radius:12px;max-width:100%;height:auto';
      const context=canvas.getContext('2d');context.drawImage(image,0,0,400,650);document.body.append(canvas);
      const bytes=context.getImageData(0,0,400,650).data,channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));let painted=0,selected=0;
      for(let i=0;i<bytes.length;i+=4){if(bytes[i+3]>0)painted++;if(bytes[i+3]>240&&channels.every((channel,j)=>Math.abs(channel-bytes[i+j])<3))selected++;}
      const geometry=doc=>[...doc.querySelectorAll('path')].map(node=>node.getAttribute('d'));
      renders.push({color,decoded:image.naturalWidth>0,pathsUnchanged:JSON.stringify(geometry(original))===JSON.stringify(geometry(parsed)),maskRetained:parsed.querySelector('mask')?.getAttribute('style')==='mask-type:luminance',painted,selected});URL.revokeObjectURL(url);
    }
    const sample=style=>`<svg xmlns="http://www.w3.org/2000/svg"><mask style="${style}"/></svg>`;
    const rejected=['mask-type:url(https://example.com/x)','mask-type:luminance;behavior:url(#x)','mask-type:var(--x)','mask-type:alpha !important'].map(value=>{try{preparePreviewSvg(sample(value));return false;}catch{return true;}});
    let otherElementRejected=false;try{preparePreviewSvg('<svg xmlns="http://www.w3.org/2000/svg"><path style="mask-type:luminance"/></svg>');}catch{otherElementRejected=true;}
    const alphaAllowed=preparePreviewSvg(sample('mask-type:alpha')).includes('mask-type:alpha');
    return {renders,rejected,otherElementRejected,alphaAllowed};
  },source);
  for(const render of result.renders){assert(render.decoded);assert(render.pathsUnchanged);assert(render.maskRetained);assert(render.painted>50000);assert(render.selected>20000);}
  assert(result.rejected.every(Boolean));assert(result.otherElementRejected);assert(result.alphaAllowed);assert.deepEqual(errors,[]);
  const screenshot=path.join(path.dirname(filename),'source-replay.png');await page.screenshot({path:screenshot});fs.chmodSync(screenshot,0o600);
  console.log(JSON.stringify({...result,screenshot},null,2));
} finally {await browser.close();}
