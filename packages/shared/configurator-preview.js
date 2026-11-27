/** Geometry and painter order from the pinned Flutter custom_mockup.dart. */
export function previewGeometry(asset, mirror = false) {
  const ratio=Number(asset.height_ratio),x=Number(mirror?asset.mirror_offset_x:asset.offset_x??0),y=Number(asset.offset_y??0);
  if(!Number.isFinite(ratio)||ratio<=0||!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Preview positioning is incomplete.');
  return {left:`${x*100}%`,top:`${y*100}%`,height:`${100/ratio}%`,transform:mirror?'scaleX(-1)':undefined};
}
export function nativePreviewGeometry(asset, mirror = false) {
  const ratio=Number(asset.height_ratio),x=Number(mirror?asset.mirror_offset_x:asset.offset_x??0),y=Number(asset.offset_y??0);
  if(!Number.isFinite(ratio)||ratio<=0||!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Preview positioning is incomplete.');
  return {x,y,height:1/ratio,mirror};
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
