export const MEDIA_LIMITS = Object.freeze({ 'image/png':10485760, 'image/jpeg':10485760, 'image/webp':10485760, 'image/gif':10485760, 'image/svg+xml':5242880, 'application/pdf':26214400, 'application/octet-stream':26214400, 'video/mp4':104857600, 'video/webm':104857600 });
const EXTENSIONS = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif', svg:'image/svg+xml', pdf:'application/pdf', mp4:'video/mp4', webm:'video/webm' };
export const LEGACY_ATTACHMENT_EXTENSIONS=Object.freeze('doc docx xlxs xlsx xls xlsm xlsb xltx xltm xlt xlam xla xll xlw pptx pptm potx potm ppam ppa ppsx ppsm sldx sldm psd ai eps tiff tif bmp indd zip rar 7z csv ppt aiff wma ogg flac cdr raw'.split(' '));
const legacyAttachment=target=>target?.resource==='brandings'&&target?.field==='attachment';
export function mediaAccept(target){return [...allowedMediaTypes(target).filter(type=>type!=='application/octet-stream'),...(legacyAttachment(target)?LEGACY_ATTACHMENT_EXTENSIONS.map(extension=>'.'+extension):[])].join(',');}
// The resolver canonicalizes an omitted root pointer to ''. Match that identity
// when catalogue descriptors omit it, without conflating distinct array leaves.
export function referenceKey(reference) { return JSON.stringify([reference?.resource,String(reference?.record_id ?? ''),reference?.field,reference?.pointer ?? '']); }
export function mediaReference(reference) { if(!reference?.resource || reference.record_id == null || !reference.field)return null;return {resource:reference.resource,record_id:String(reference.record_id),field:reference.field,...(reference.pointer!=null?{pointer:reference.pointer}:{})}; }
export function allowedMediaTypes(target) {
  if(target?.field==='embeded_video')return ['video/mp4','video/webm'];
  const types=['image/png','image/jpeg','image/webp','image/gif'];
  if(['asset_infos','add_ons','brandings'].includes(target?.resource))types.push('image/svg+xml');
  if(target?.resource==='asset_infos'||legacyAttachment(target))types.push('application/pdf');
  if(legacyAttachment(target))types.push('application/octet-stream');
  return types;
}
export function validateMediaFile(file,target) {
  if(!file || file.size<1)throw new Error('Choose a file that is not empty.');
  if(!file.name || file.name.length>180 || /[/\\\x00-\x1f\x7f]/.test(file.name))throw new Error('Use a filename of 180 characters or fewer without slashes or control characters.');
  const extension=file.name.split('.').at(-1).toLowerCase();
  const opaque=legacyAttachment(target)&&LEGACY_ATTACHMENT_EXTENSIONS.includes(extension);
  const mime=opaque?'application/octet-stream':file.type||EXTENSIONS[extension];
  if(mime==='application/octet-stream'&&!opaque)throw new Error('This file extension is not supported for design attachments.');
  if(!allowedMediaTypes(target).includes(mime))throw new Error('This file type is not supported for this field.');
  if(file.size>MEDIA_LIMITS[mime])throw new Error(`This file must be ${Math.round(MEDIA_LIMITS[mime]/1048576)} MB or smaller.`);
  return mime;
}
export function safeMediaUrl(value,origin,upload=false) {
  try { const url=new URL(value); const expected=new URL(origin);const prefix=upload?'/storage/v1/object/upload/sign/squad-uploads/pending/':'/storage/v1/object/sign/canto-media/';
    return url.protocol==='https:'&&url.origin===expected.origin&&!url.username&&!url.password&&url.pathname.startsWith(prefix)&&!url.pathname.includes('\\')?url.href:null;
  } catch { return null; }
}
export function formatBytes(bytes) { const value=Number(bytes);if(!Number.isFinite(value)||value<0)return '';return value<1048576?`${Math.max(1,Math.round(value/1024))} KB`:`${(value/1048576).toFixed(value<10485760?1:0)} MB`; }
