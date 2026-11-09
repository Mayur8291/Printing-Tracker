import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedMediaTypes,LEGACY_ATTACHMENT_EXTENSIONS,mediaAccept,mediaReference,referenceKey,safeMediaUrl,validateMediaFile} from './mediaModel.js';
const origin='https://staging.example.test';
test('signed media never crosses environments or accepts unsafe URL schemes',()=>{
 const path='/storage/v1/object/sign/canto-media/sha256/ab/abcd?token=x';
 assert.equal(safeMediaUrl(origin+path,origin),origin+path);
 for(const value of ['https://production.example.test'+path,'javascript:alert(1)','data:image/png;base64,eA==','https://user:pass@staging.example.test'+path,origin+'/legacy/image.png'])assert.equal(safeMediaUrl(value,origin),null);
 assert.equal(safeMediaUrl(origin+'/storage/v1/object/upload/sign/squad-uploads/pending/id?token=x',origin,true),origin+'/storage/v1/object/upload/sign/squad-uploads/pending/id?token=x');
 assert.equal(safeMediaUrl(origin+path,origin,true),null);
});
test('upload type/size rules match field constraints before server verification',()=>{
 assert.deepEqual(allowedMediaTypes({field:'embeded_video'}),['video/mp4','video/webm']);
 const target={resource:'brandings',field:'attachment'};
 assert.equal(validateMediaFile({name:'artwork.svg',size:5242880,type:'image/svg+xml'},target),'image/svg+xml');
 assert.throws(()=>validateMediaFile({name:'artwork.svg',size:5242881,type:'image/svg+xml'},target),/5 MB/);
 assert.throws(()=>validateMediaFile({name:'paper.pdf',size:1,type:'application/pdf'},{resource:'users',field:'image'}),/not supported/);
 assert.throws(()=>validateMediaFile({name:'a.png',size:0,type:'image/png'},target),/empty/);
 assert.throws(()=>validateMediaFile({name:'../a.png',size:1,type:'image/png'},target),/filename/);
 assert.throws(()=>validateMediaFile({name:'a.html',size:1,type:'text/html'},target),/not supported/);
});
test('reference identity includes pointer and excludes source URLs and transport secrets',()=>{
 const a={resource:'items',record_id:123,field:'images',pointer:'/0',url:'https://legacy.test',token:'secret'};
 assert.deepEqual(mediaReference(a),{resource:'items',record_id:'123',field:'images',pointer:'/0'});
 assert.notEqual(referenceKey(a),referenceKey({...a,pointer:'/1'}));
 assert.equal(mediaReference({...a,record_id:null}),null);
 const root={resource:'asset_infos',record_id:'554',field:'asset'};
 assert.equal(referenceKey(root),referenceKey({...root,pointer:''}));
 assert.equal(referenceKey({...root,pointer:null}),referenceKey({...root,pointer:''}));
 assert.notEqual(referenceKey(root),referenceKey({...root,pointer:'/0'}));
 assert.deepEqual(mediaReference({...root,pointer:null}),root);
});

test('legacy design formats are opaque only for the exact attachment field',()=>{
 const target={resource:'brandings',field:'attachment'};
 for(const extension of LEGACY_ATTACHMENT_EXTENSIONS){const file={name:'original.'+extension,size:26214400,type:'application/vendor-format'};assert.equal(validateMediaFile(file,target),'application/octet-stream');assert.throws(()=>validateMediaFile(file,{resource:'brandings',field:'image'}),/not supported/);assert(mediaAccept(target).includes('.'+extension));}
 assert.equal(validateMediaFile({name:'DESIGN.PSD',size:1,type:''},target),'application/octet-stream');
 assert.throws(()=>validateMediaFile({name:'design.psd',size:26214401,type:''},target),/25 MB/);
 for(const name of ['code.exe','page.html','file.bin','script.js'])assert.throws(()=>validateMediaFile({name,size:1,type:'application/octet-stream'},target),/extension/);
 assert(!mediaAccept({resource:'users',field:'profile_image'}).includes('.psd'));
 assert.equal(validateMediaFile({name:'artwork.svg',size:1,type:'image/svg+xml'},target),'image/svg+xml');
});
