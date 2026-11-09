// Geometry and layer order pinned to Flutter develop 5d55d946 custom_mockup.dart.
export function previewGeometry(asset, mirror = false) {
  const ratio=Number(asset.height_ratio),x=Number(mirror?asset.mirror_offset_x:asset.offset_x??0),y=Number(asset.offset_y??0);
  if(!Number.isFinite(ratio)||ratio<=0||!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Preview positioning is incomplete.');
  return {left:`${x*100}%`,top:`${y*100}%`,height:`${100/ratio}%`,transform:mirror?'scaleX(-1)':undefined};
}
export function previewLayers(base,addons) {
  const sorted=[...addons].sort((a,b)=>Number(a.layerSort??0)-Number(b.layerSort??0));
  const regular=[...base.map(layer=>({...layer,mirror:false})),...sorted.map(layer=>({...layer,mirror:false}))];
  return [...regular,...sorted.filter(layer=>layer.asset.mirror_offset_x!=null&&Number(layer.asset.mirror_offset_x)!==-1).map(layer=>({...layer,mirror:true}))];
}
export function previewColor(color) {
  if(color==null||color==='')return null;
  if(!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color))throw new Error('The selected preview color is not supported.');
  return color;
}
const ELEMENTS=new Set('svg g defs path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop clipPath mask pattern'.split(' '));
const ATTRIBUTES=new Set('id xmlns xmlns:xlink version viewBox width height x y x1 y1 x2 y2 cx cy r rx ry dx dy d points fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity transform gradientTransform gradientUnits spreadMethod offset stop-color stop-opacity clip-path clip-rule mask maskUnits maskContentUnits patternUnits patternContentUnits patternTransform preserveAspectRatio font-family font-size font-weight font-style text-anchor dominant-baseline style'.split(' '));
const STYLES=new Set('fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity stop-color stop-opacity font-family font-size font-weight font-style text-anchor dominant-baseline'.split(' '));
function safeValue(value) {
  if(/[\\@<>]|(?:javascript|data|https?|file)\s*:/i.test(value))throw new Error('Artwork contains an unsafe reference.');
  for(const match of value.matchAll(/url\s*\(([^)]*)\)/gi))if(!/^#[a-zA-Z_][\w:.-]*$/.test(match[1].trim()))throw new Error('Artwork contains an external reference.');
  if(/url/i.test(value.replace(/url\s*\(#[a-zA-Z_][\w:.-]*\)/gi,'')))throw new Error('Artwork contains an unsupported reference.');
}
/** Reject unsafe SVG completely. Serialized result is used only as an img Blob,
 * never inserted into the document. Whitelist matches server media verification. */
export function preparePreviewSvg(source,color=null) {
  if(typeof source!=='string'||source.length>5242880||/<!DOCTYPE|<!ENTITY/i.test(source))throw new Error('Artwork is invalid or too large.');
  const document=new DOMParser().parseFromString(source,'image/svg+xml'),root=document.documentElement;
  if(document.querySelector('parsererror')||root?.localName!=='svg'||root.namespaceURI!=='http://www.w3.org/2000/svg')throw new Error('Artwork is not a valid SVG.');
  const queue=[...document.childNodes].map(node=>({node,depth:0}));let count=0;
  const selected=previewColor(color);
  // Recolor only paint attributes/styles; never rewrite IDs, paths or text.
  const recolor=value=>selected?value.replace(/(^|[\s:;(])(white|#ffffff|#fff)(?=$|[\s;)])/gi,(_,prefix)=>prefix+selected):value;
  while(queue.length){const {node,depth}=queue.pop();if(++count>10000||depth>64)throw new Error('Artwork is too complex.');
    if(node.nodeType===1){if(!ELEMENTS.has(node.localName)||node.namespaceURI!=='http://www.w3.org/2000/svg')throw new Error('Artwork contains an unsupported element.');
      for(const attr of [...node.attributes]){
        if(!ATTRIBUTES.has(attr.name)||attr.value.length>1048576)throw new Error('Artwork contains an unsupported attribute.');
        if(attr.name==='xmlns'){if(attr.value!=='http://www.w3.org/2000/svg')throw new Error('Invalid artwork namespace.');continue;}
        if(attr.name==='xmlns:xlink'){if(attr.value!=='http://www.w3.org/1999/xlink')throw new Error('Invalid artwork namespace.');continue;}
        safeValue(attr.value);
        if(attr.name==='style')for(const part of attr.value.split(';').filter(s=>s.trim())){
          const colon=part.indexOf(':'),property=part.slice(0,colon).trim(),value=part.slice(colon+1).trim();
          // Original Figma garment exports use luminance masks. Permit this
          // paint-only declaration narrowly; never admit arbitrary CSS.
          const maskType=property==='mask-type'&&node.localName==='mask'&&/^(luminance|alpha)$/.test(value);
          if(colon<1||(!STYLES.has(property)&&!maskType))throw new Error('Artwork contains an unsupported style.');
          safeValue(value);
        }
        if(['fill','stroke','stop-color','style'].includes(attr.name))node.setAttribute(attr.name,recolor(attr.value));
      }
    }else if(![3,4,8].includes(node.nodeType))throw new Error('Artwork contains an unsupported instruction.');
    for(const child of node.childNodes??[])queue.push({node:child,depth:depth+1});
  }
  return new XMLSerializer().serializeToString(document);
}
export async function readPreviewSvg(url,signal) {
  const response=await fetch(url,{signal,credentials:'omit',redirect:'error'});
  if(!response.ok||!response.body)throw new Error('Artwork could not be loaded.');
  if(Number(response.headers.get('content-length'))>5242880)throw new Error('Artwork is too large.');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5242880)throw new Error('Artwork is too large.');chunks.push(value);}}finally{await reader.cancel();reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
