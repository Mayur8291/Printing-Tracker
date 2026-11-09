import {useEffect,useRef,useState} from 'react';
import {Crop,Download,ExternalLink,FileText,ImageOff,LoaderCircle,RefreshCw,Trash2,UploadCloud,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import ImageCropDialog from './ImageCropDialog';
import {Textarea} from '@/components/ui/textarea';
import {useSquad,useSquadCommand,useSquadQuery} from '../data/hooks';
import {getEnvironmentConfig} from '../../runtimeEnv';
import {cn} from '@/lib/utils';
import {CommandDialog,Field} from './index.jsx';
import {mediaAccept,formatBytes,mediaReference,referenceKey,safeMediaUrl,validateMediaFile} from './mediaModel';
import {prepareMediaNavigation} from './mediaNavigation';

/** Resolve up to 25 references per authorized request. Call once per card/list page
 * and pass the returned grants to MediaViewer to avoid one request per image. */
export function useMediaGrants(references=[],{enabled=true}={}) {
  const {sdk}=useSquad();
  const unique=[...new Map(references.map(mediaReference).filter(Boolean).map(ref=>[referenceKey(ref),ref])).values()];
  unique.sort((a,b)=>referenceKey(a).localeCompare(referenceKey(b)));
  return useSquadQuery(['media-grants',unique],async ({sdk}) => {
    const result=[];
    for(let index=0;index<unique.length;index+=25){const batch=await sdk.mediaGrants(unique.slice(index,index+25));result.push(...batch.references);}
    return result;
  },{enabled:enabled&&unique.length>0,staleTime:60000,gcTime:120000});
}
export function MediaViewer({reference,grant:providedGrant,label='Attachment',compact=false,loading:providedLoading=false,className}) {
  const {sdk,environment,scope}=useSquad();
  const previewRequest=useRef(0);
  const downloadAttempt=useRef(null),downloadContext=useRef(null);
  const fileKey=referenceKey(reference);
  downloadContext.current={sdk,environment,scope,fileKey};
  const query=useMediaGrants(reference?[reference]:[],{enabled:providedGrant===undefined});
  const [refreshedGrant,setRefreshedGrant]=useState(null);
  const grant=refreshedGrant??providedGrant??query.data?.find(item=>referenceKey(item)===referenceKey(reference));
  const [failed,setFailed]=useState(false),[downloadError,setDownloadError]=useState(''),[busy,setBusy]=useState(false);
  const origin=getEnvironmentConfig(environment).url;
  const url=grant?.status==='ready'?safeMediaUrl(grant.url,origin):null;
  const mime=grant?.content_type||'';
  useEffect(()=>{setFailed(false);setDownloadError('');},[url,referenceKey(reference)]);
  useEffect(()=>{previewRequest.current++;setRefreshedGrant(null);setBusy(false);},[referenceKey(reference),providedGrant?.url,environment]);
  useEffect(()=>{
    setBusy(false);
    return()=>{const attempt=downloadAttempt.current;downloadAttempt.current=null;attempt?.abort.abort();attempt?.navigation.cancel();};
  },[sdk,environment,scope,fileKey]);
  async function retryPreview() {
    const request=++previewRequest.current;
    setBusy(true);setDownloadError('');
    try {
      const target=mediaReference(reference||grant);
      if(!target)throw new Error('This file is not available.');
      const response=await sdk.mediaGrants([target]);
      if(request===previewRequest.current){setRefreshedGrant(response.references[0]??{...target,status:'missing'});setFailed(false);}
    } catch(error) {if(request===previewRequest.current)setDownloadError(error.message||'The file could not be refreshed. Please try again.');}
    finally {if(request===previewRequest.current)setBusy(false);}
  }
  async function download(asDownload=true) {
    if(downloadAttempt.current)return;
    setBusy(true);setDownloadError('');
    let attempt;
    try {
      const target=mediaReference(reference||grant);if(!target)throw new Error('This file is not available.');
      attempt={navigation:prepareMediaNavigation(asDownload),abort:new AbortController(),context:downloadContext.current};downloadAttempt.current=attempt;
      const client=sdk.withSignal?sdk.withSignal(attempt.abort.signal):sdk;
      const refs=await client.mediaGrants([target],{download:asDownload});
      if(downloadAttempt.current!==attempt||Object.keys(attempt.context).some(key=>attempt.context[key]!==downloadContext.current[key])){attempt.navigation.cancel();return;}
      const current=refs.references.find(item=>referenceKey(item)===referenceKey(target));
      const signed=current?.status==='ready'&&safeMediaUrl(current.url,origin);if(!signed)throw new Error('This file is not available.');
      attempt.navigation.complete(signed);
    }
    catch(error){attempt?.navigation.cancel();if(!attempt||downloadAttempt.current===attempt)setDownloadError(error.message||'The file could not be opened. Please try again.');}
    finally{if(!attempt||downloadAttempt.current===attempt){downloadAttempt.current=null;setBusy(false);}}
  }
  const pending=providedLoading||(providedGrant===undefined&&query.isLoading&&!!reference);
  const missing=grant?.status==='missing';
  const empty=!reference||grant?.status==='empty';
  const unavailable=failed||(!url&&!pending);
  return <div className={cn('squad-media',compact&&'squad-media-compact',className)}>
    <div className="squad-media-preview">
      {pending?<LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-label="Loading file"/>:url&&!failed&&['image/png','image/jpeg','image/webp','image/gif'].includes(mime)?<img src={url} alt={label} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>:url&&!failed&&['video/mp4','video/webm'].includes(mime)?<video src={url} controls preload="metadata" aria-label={label} onError={()=>setFailed(true)}/>:url&&!failed&&mime==='audio/mpeg'?<audio src={url} controls preload="metadata" aria-label={label} onError={()=>setFailed(true)}/>:<div className="squad-media-placeholder">{url?<FileText className="size-7"/>:<ImageOff className="size-6"/>}<span>{pending?'Loading file':url?mime==='application/pdf'?'PDF document':mime==='image/svg+xml'?'SVG artwork':'File attachment':missing?'File missing from source':empty?'No attachment':grant?.status==='pending'?'File is being prepared':'File unavailable'}</span>{!compact&&missing&&<small>This file was unavailable in this environment’s source.</small>}</div>}
    </div>
    {!compact&&<div className="squad-media-footer"><div className="min-w-0"><p className="truncate text-sm font-medium">{label}</p>{grant?.bytes&&<p className="text-xs text-muted-foreground">{formatBytes(grant.bytes)}</p>}</div>{url&&<div className="flex shrink-0 gap-2">{['application/pdf','image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm'].includes(mime)&&<Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>download(false)}><ExternalLink className="size-3.5"/>Open</Button>}<Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>download(true)}>{busy?<LoaderCircle className="size-3.5 animate-spin"/>:<Download className="size-3.5"/>}Download</Button></div>}</div>}
    {unavailable&&!empty&&!missing&&<div className="px-3 pb-3"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={retryPreview}><RefreshCw className="size-3.5"/>{busy?'Refreshing…':'Retry preview'}</Button></div>}
    {downloadError&&<p role="alert" className="px-3 pb-3 text-xs text-destructive">{downloadError}</p>}
  </div>;
}

export function putFile(url,file,mime,onProgress,signal) {
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('PUT',url);xhr.setRequestHeader('Content-Type',mime);xhr.timeout=180000;
    const abort=()=>xhr.abort();signal.addEventListener('abort',abort,{once:true});
    const done=(callback,value)=>{signal.removeEventListener('abort',abort);callback(value);};
    xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.round(event.loaded/event.total*100));};
    xhr.onload=()=>done(resolve,xhr.status);xhr.onerror=()=>done(reject,new Error('The upload was interrupted. Retry to continue.'));xhr.ontimeout=()=>done(reject,new Error('The upload took too long. Retry to continue.'));xhr.onabort=()=>done(reject,new Error('Upload cancelled.'));
    if(signal.aborted){done(reject,new Error('Upload cancelled.'));return;}xhr.send(file);
  });
}

/** For existing saved entities only. Aggregate forms must stage files and attach
 * atomically through their own command instead of using a standalone field. */
export function MediaField({target,reference,label='Attachment',canWrite,onSaved,allowDetach=true,preparedFile,onBusyChange}) {
  const context=useSquad(),{sdk,environment}=context;
  const permitted=canWrite===undefined?context.canWrite:canWrite&&context.canWrite;
  const command=useSquadCommand();
  const input=useRef(null),attempt=useRef(null),abort=useRef(null),alive=useRef(true),uploadLock=useRef(false);
  const [file,setFile]=useState(null),[error,setError]=useState(''),[phase,setPhase]=useState(''),[progress,setProgress]=useState(0),[success,setSuccess]=useState('');
  const [cropOpen,setCropOpen]=useState(false);
  const busyCallback=useRef(onBusyChange);busyCallback.current=onBusyChange;
  const [removeOpen,setRemoveOpen]=useState(false),[reason,setReason]=useState('');
  const key=referenceKey(target);const ref=reference||{...target,status:'empty'};
  const grants=useMediaGrants(target?.record_id!=null?[ref]:[]);const grant=grants.data?.find(item=>referenceKey(item)===referenceKey(ref));
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort();};},[]);
  useEffect(()=>{attempt.current=null;setFile(null);setError('');setPhase('');setSuccess('');if(input.current)input.current.value='';},[key]);
  useEffect(()=>{if(!preparedFile||uploadLock.current)return;try{validateMediaFile(preparedFile,target);attempt.current=null;setFile(preparedFile);setError('');setSuccess('');}catch(error){setError(error.message);}},[preparedFile,key]);
  const update=(fn,...args)=>{if(alive.current)fn(...args);};
  function choose(event){const next=event.target.files?.[0];setError('');setSuccess('');if(!next)return;try{validateMediaFile(next,target);attempt.current=null;setFile(next);}catch(error){setFile(null);event.target.value='';setError(error.message);}}
  async function upload(){
    if(!file||command.pending||uploadLock.current||!permitted)return;
    uploadLock.current=true;setPhase('Preparing upload');setProgress(0);setError('');setSuccess('');
    try {
      const mime=validateMediaFile(file,target);
      if(target?.record_id==null)throw new Error('Save the record before attaching a file.');
      if(!attempt.current){const response=await sdk.mediaGrants([target]);const version=response.references[0]?.version;if(!version)throw new Error('This attachment cannot be changed. Reload the record and try again.');attempt.current={file,version,reserveKey:crypto.randomUUID(),verifyKey:crypto.randomUUID(),finalizeKey:crypto.randomUUID()};}
      const current=attempt.current;
      const result=await command.run(async()=>{
        update(setPhase,'Preparing upload');
        const reservation=await sdk.reserveMediaUpload(target,{filename:file.name,bytes:String(file.size),content_type:mime},{expectedVersion:current.version,idempotencyKey:current.reserveKey});
        current.id=reservation.upload_id;
        if(reservation.state==='reserved'){
          const url=safeMediaUrl(reservation.upload_url,getEnvironmentConfig(environment).url,true);if(!url)throw new Error('The upload could not be prepared.');
          update(setPhase,'Uploading');abort.current=new AbortController();
          const status=await putFile(url,file,mime,value=>update(setProgress,value),abort.current.signal);
          // A lost PUT response can leave a write-once file already present.
          // Only server byte/type verification can rescue a duplicate response.
          if(!(status>=200&&status<300)&&![400,409].includes(status))throw new Error('The file could not be uploaded. Retry to continue.');
        }else if(!['verified','attached'].includes(reservation.state))throw new Error('This upload is no longer available. Choose the file again.');
        update(setPhase,'Checking file');
        await sdk.verifyMediaUpload(current.id,{expectedVersion:current.version,idempotencyKey:current.verifyKey});
        update(setPhase,'Saving file');
        return sdk.finalizeMediaUpload(current.id,{expectedVersion:current.version,idempotencyKey:current.finalizeKey});
      },{key:'media.upload',payload:{target,file:{name:file.name,size:file.size,lastModified:file.lastModified}},expectedVersion:current.version});
      attempt.current=null;update(setFile,null);update(setSuccess,'File saved.');if(input.current)input.current.value='';await onSaved?.(result);await grants.refetch();
    }catch(error){update(setError,error.kind==='conflict'?'This record changed. Reload it before replacing the attachment.':error.message||'The file could not be saved.');}
    finally{uploadLock.current=false;abort.current=null;update(setPhase,'');}
  }
  async function detach(){
    if(reason.trim().length<3){setError('Enter a reason of at least 3 characters.');return;}
    setError('');
    try {const version=grant?.version;if(!version)throw new Error('Reload the attachment before removing it.');const result=await command.run(cmd=>sdk.detachMedia(target,reason.trim(),cmd),{key:'media.detach',payload:{target,reason:reason.trim()},expectedVersion:version});setRemoveOpen(false);setReason('');setSuccess('Attachment removed.');await onSaved?.(result);await grants.refetch();}
    catch(error){setError(error.message||'The attachment could not be removed.');}
  }
  const busy=command.pending||!!phase;
  useEffect(()=>{busyCallback.current?.(busy);},[busy]);
  useEffect(()=>()=>busyCallback.current?.(false),[]);
  return <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{label}</h3>{allowDetach&&grant?.status==='ready'&&<Button type="button" variant="ghost" size="sm" disabled={!permitted||busy} onClick={()=>{setError('');setRemoveOpen(true);}}><Trash2 className="size-3.5"/>Remove</Button>}</div>
    <MediaViewer reference={ref} grant={grant} label={label}/>
    <div className="squad-upload-zone"><UploadCloud className="size-5 text-muted-foreground"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file?file.name:'Choose a file to attach'}</p><p className="mt-1 text-xs text-muted-foreground">{file?formatBytes(file.size):target?.field==='embeded_video'?'MP4 or WebM, up to 100 MB':target?.resource==='brandings'&&target?.field==='attachment'?'Images up to 10 MB; PDF and supported design, office or archive files up to 25 MB. Design files are download-only.':'Images up to 10 MB; other supported files have their own limits.'}</p></div><Button type="button" variant="outline" size="sm" disabled={!permitted||busy||target?.record_id==null} onClick={()=>input.current?.click()}>Choose file</Button><input ref={input} type="file" className="sr-only" accept={mediaAccept(target)} aria-label={`Choose ${label.toLowerCase()}`} disabled={!permitted||busy} onChange={choose}/></div>
    {file&&<div className="flex flex-wrap items-center gap-2">{['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)&&<Button type="button" variant="outline" disabled={busy} onClick={()=>setCropOpen(true)}><Crop className="size-4"/>Crop image</Button>}<Button type="button" onClick={upload} disabled={!permitted||busy}>{busy?<LoaderCircle className="size-4 animate-spin"/>:<UploadCloud className="size-4"/>}{busy?phase||'Saving…':error?'Retry upload':'Upload and save'}</Button>{!busy&&<Button type="button" variant="ghost" onClick={()=>{setFile(null);setError('');attempt.current=null;if(input.current)input.current.value='';}}>Cancel</Button>}{phase==='Uploading'&&<Button type="button" variant="ghost" onClick={()=>abort.current?.abort()}><X className="size-4"/>Cancel upload</Button>}</div>}
    {phase==='Uploading'&&<div className="space-y-1"><progress className="h-1.5 w-full" value={progress} max="100" aria-label="Upload progress"/><p className="text-xs text-muted-foreground" role="status">Uploading {progress}%</p></div>}
    {error&&!removeOpen&&<p role="alert" className="text-sm text-destructive">{error}</p>}{success&&<p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{success}</p>}
    {cropOpen&&file&&<ImageCropDialog file={file} onClose={()=>setCropOpen(false)} onApply={cropped=>{attempt.current=null;setFile(cropped);setError('');setSuccess('');if(input.current)input.current.value='';}}/>}
    <CommandDialog open={removeOpen} onOpenChange={setRemoveOpen} title="Remove attachment" description="The file will no longer be attached to this record. Enter a reason to continue." submitLabel="Remove attachment" destructive pending={command.pending} error={error} onSubmit={detach}><Field label="Reason" required><Textarea value={reason} minLength={3} maxLength={2000} onChange={event=>setReason(event.target.value)} required/></Field></CommandDialog>
  </section>;
}
