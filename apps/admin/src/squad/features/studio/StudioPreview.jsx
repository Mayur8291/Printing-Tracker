import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useSquad,useSquadQuery} from '../../data/hooks';
import {getEnvironmentConfig} from '../../../runtimeEnv';
import ConfiguratorPreview from '../../components/ConfiguratorPreview';
import {useMediaGrants} from '../../components/Media';
import {referenceKey,safeMediaUrl} from '../../components/mediaModel';
import {studioArtworkPlacement} from './studio-artwork.generated';
import {resolveStudioDesign,STUDIO_BINDINGS} from './studio-catalogue.generated';
import registry from './assets/registry.json';
import modelUrl from './assets/garment.glb?url';

/** Current scoped catalogue records supply colours and validity; Blender only supplies geometry. */
export default function StudioPreview(props){
 const {baseId,configuration,label='Your design',artworks=[]}=props;
 const {scope,environment}=useSquad();
 return String(baseId)==='216'?<MappedPreview key={scope} {...props} artworks={artworks} environment={environment} scope={scope}/>:<div data-studio-capture-blocked={props.brandings?.some(row=>row.design_id)?'artwork-preview-unavailable':undefined}><ConfiguratorPreview baseId={baseId} configuration={configuration} label={label}/></div>;
}
function MappedPreview({baseId,configuration,label='Your design',artworks,brandings=[],environment,scope,onPartSelect}){
 const client=useQueryClient(),lastDesign=useRef(null),[rendererError,setRendererError]=useState(false),[attempt,setAttempt]=useState(0);
 const artwork=useStudioArtwork(brandings,environment);
 const renderedArtwork=[...artworks,...(artwork.data??[])];
 const query=useSquadQuery(['studio-model',baseId,configuration],async({sdk,signal})=>{
  const options=(kind,parentId,partId)=>client.fetchQuery({queryKey:['squad',scope,'studio-options',baseId,kind,parentId,partId],staleTime:300000,gcTime:1800000,queryFn:async({signal:readSignal})=>{
   const source=sdk.withSignal?sdk.withSignal(readSignal):sdk;let cursor=null;const rows=[],seen=new Set();
   do{const page=await source.configuratorOptions(baseId,kind,{parentId,partId},{cursor,limit:100});rows.push(...page.data);cursor=page.next_cursor;if(cursor&&seen.has(cursor)||rows.length>2000)throw Error('Catalogue options could not be fully loaded.');seen.add(cursor);}while(cursor);return rows;
  }});
  const catalogue={parts:await options('parts'),fabricColors:configuration.fabric_id?await options('fabric_colors',configuration.fabric_id):[],addonsByPart:{},partColorsByPart:{},addonColorsByAddon:{}};
  for(const part of configuration.parts??[]){signal.throwIfAborted();const [addons,colors]=await Promise.all([options('addons',part.part_id),options('part_colors',part.part_id)]);catalogue.addonsByPart[part.part_id]=addons;catalogue.partColorsByPart[part.part_id]=colors;for(const addon of part.addons??[])if(addons.find(row=>row.id===addon.addon_id)?.has_color)catalogue.addonColorsByAddon[`${part.part_id}:${addon.addon_id}`]=await options('addon_colors',addon.addon_id,part.part_id);}
  signal.throwIfAborted();const option=id=>id?{id:String(id)}:undefined;
  return resolveStudioDesign({projectRef:new URL(getEnvironmentConfig(environment).url).hostname.split('.')[0],selection:{base:option(baseId),designCategory:option(configuration.category_id),fabric:option(configuration.fabric_id),color:option(configuration.fabric_color_id)},parts:configuration.parts??[],catalogue,previewIncomplete:true});
 },{staleTime:300000,gcTime:1800000,refetchOnWindowFocus:false});
 const resolved=query.data?.design,complete=query.data?.status==='supported';
 // Keep one canvas and its camera alive while scoped catalogue reads or unfinished
 // selections resolve. Never reinterpret a transient editing state as 2D fallback.
 useEffect(()=>{if(resolved)lastDesign.current=resolved;},[resolved]);
 const design=resolved??lastDesign.current??{modelId:registry.modelId,visibleGroups:['Base','Body_Closed','SetInShoulderSeams'],materialColors:{BaseFabric:'#e3dfd8',Part_202_Fabric:'#e3dfd8'}};
 const pending=!complete||query.isFetching||!!query.error||artwork.pending||!!artwork.error||rendererError;
 return <div data-preview-state={rendererError?'error':query.isFetching?'loading':query.data?.status??'loading'} data-studio-capture-blocked={pending?'preview-incomplete':undefined}>
  <CanvasPreview key={attempt} onPartSelect={onPartSelect} design={{...design,artworks:renderedArtwork}} pending={pending} label={label} onFailure={()=>setRendererError(true)}/>
  {rendererError&&<p role="alert" className="studio-preview-notice">3D could not load. Your selections are preserved. <button type="button" onClick={()=>{setRendererError(false);setAttempt(value=>value+1);}}>Retry 3D</button></p>}
  {query.data?.status==='incomplete'&&<p role="status" className="studio-preview-notice">{query.data.pendingFields.join(' ')} Unchosen colours follow the fabric in this preview.</p>}
  {query.data?.status==='unsupported'&&<p role="status" className="studio-preview-notice">Preview paused: {query.data.reason} Showing the last available 3D preview.</p>}
  {artwork.error&&<p role="alert" className="p-4 text-xs">{artwork.error.message} Your artwork remains attached; a complete preview cannot be captured yet.</p>}
  {query.error&&<p role="alert" className="p-4 text-sm">{query.error.message} <button type="button" onClick={()=>query.refetch()}>Retry preview</button></p>}
  {query.data?.nonVisualDetails?.length>0&&<details className="px-5 py-3 text-xs text-muted-foreground"><summary>Details saved as specifications</summary><ul>{query.data.nonVisualDetails.map(text=><li key={text}>{text}</li>)}</ul></details>}
 </div>;
}
function CanvasPreview({design,pending,label,onFailure,onPartSelect}){
 const root=useRef(null),host=useRef(null),canvas=useRef(null),runtime=useRef(null),revision=useRef(0),readyRevision=useRef(0),capture=useRef(null),captureEpoch=useRef(0),latest=useRef(design),pendingRef=useRef(pending),[ready,setReady]=useState(false),[omitted,setOmitted]=useState([]);
 const partCallback=useRef(onPartSelect);partCallback.current=onPartSelect;
 latest.current=design;pendingRef.current=pending;
 const key=JSON.stringify(design),submittedKey=useRef(null),desiredKey=useRef(key),[acknowledgedKey,setAcknowledgedKey]=useState(null);
 desiredKey.current=key;
 const captureReady=acknowledgedKey===key&&!pending&&omitted.length===0;
 function invalidateCapture(message){captureEpoch.current++;const ticket=capture.current;capture.current=null;ticket?.reject(Error(message));}
 useEffect(()=>{let alive=true;import('./studio-renderer.generated').then(({createStudioRenderer})=>{
  if(!alive)return;
  runtime.current=createStudioRenderer({canvas:canvas.current,container:host.current,registry,modelUrl,groupPartMap:{Base:'202',Body_Closed:'202',Body_Slit:'202',...Object.fromEntries(STUDIO_BINDINGS.map(row=>[row.modelGroup,row.part_id]))},onEvent:event=>{
   if(!alive)return;
   if(event.type==='part')partCallback.current?.(event.partId);
   if(event.type==='ready'&&event.revision===revision.current){readyRevision.current=event.revision;setAcknowledgedKey(submittedKey.current);setReady(true);setOmitted(event.omittedArtworkIds);}
   if(event.type==='interaction')invalidateCapture('The view changed during capture. Please try again.');
   if(event.type==='error'){invalidateCapture('The preview could not be captured.');setAcknowledgedKey(null);onFailure();}
   if(event.type==='recovering'){invalidateCapture('The preview is recovering. Please try again.');readyRevision.current=0;setAcknowledgedKey(null);setReady(false);}
   if(event.type==='capture'&&capture.current?.revision===event.revision&&capture.current.id===event.requestId){
    const ticket=capture.current;if(ticket.converting)return;ticket.converting=true;
    const isCurrent=()=>alive&&capture.current===ticket&&ticket.epoch===captureEpoch.current&&event.revision===revision.current&&submittedKey.current===desiredKey.current&&!pendingRef.current;
    const fail=error=>{if(capture.current===ticket)capture.current=null;ticket.reject(error);};
    if(!isCurrent()){fail(Error('The design changed during capture.'));return;}
    fetch(event.dataUri).then(response=>response.blob()).then(blob=>{
     if(!isCurrent()){fail(Error('The view or design changed during capture.'));return;}
     capture.current=null;ticket.resolve(new File([blob],'design-mockup.png',{type:'image/png'}));
    },fail);
   }
  }});
  if(latest.current){submittedKey.current=JSON.stringify(latest.current);runtime.current.command({type:'design',revision:++revision.current,design:latest.current});}
 }).catch(()=>{if(alive)onFailure();});
 return()=>{alive=false;invalidateCapture('The preview was closed.');runtime.current?.dispose();runtime.current=null;};
 },[]);
 useEffect(()=>{invalidateCapture('The design changed during capture.');readyRevision.current=0;setAcknowledgedKey(null);if(runtime.current&&design){submittedKey.current=key;runtime.current.command({type:'design',revision:++revision.current,design});}},[key]);
 useEffect(()=>{const node=root.current;node.captureStudioPreview=()=>{
  if(!runtime.current||pendingRef.current||readyRevision.current!==revision.current||submittedKey.current!==desiredKey.current||!design||omitted.length)throw Error('Wait for the complete design preview before capturing it.');
  if(capture.current)throw Error('A preview capture is already in progress.');
  return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{if(capture.current?.id===id){capture.current=null;reject(Error('The preview capture timed out.'));}},10000);capture.current={id,epoch:captureEpoch.current,converting:false,revision:revision.current,resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};runtime.current.command({type:'capture',revision:revision.current,requestId:id});});
 };return()=>{delete node.captureStudioPreview;};},[key,omitted]);
 return <section ref={root} className="squad-studio-preview" data-capture-ready={captureReady?'true':'false'} data-studio-capture-blocked={captureReady?undefined:'preview-incomplete'} aria-label={label}><div ref={host} className="studio-canvas-host"><canvas ref={canvas} aria-label={`${label}. Drag to rotate; use front and back buttons for preset views.`} role="img" style={{width:'100%',height:'100%',touchAction:'none'}}/>{!ready&&<div className="absolute inset-0 flex items-center justify-center bg-stone-100/90 animate-pulse" role="status">Preparing your garment…</div>}{ready&&acknowledgedKey!==key&&<p role="status" className="absolute bottom-3 inset-x-0 pointer-events-none text-center text-xs text-muted-foreground">Updating preview…</p>}</div><div className="studio-camera-toolbar">{['front','back','reset'].map(view=><button type="button" key={view} className="studio-camera-button" onClick={()=>runtime.current?.command({type:'view',view})}>{view}</button>)}</div><p className="text-center text-xs text-muted-foreground">Drag to rotate · Scroll or pinch to zoom</p>{omitted.length>0&&<p role="status" className="p-4 text-xs">Some artwork placements cannot be shown accurately in this preview. They remain in your design specifications.</p>}</section>;
}

function useStudioArtwork(brandings,environment){
 const refs=brandings.filter(row=>row.design_id).map(row=>({resource:'brandings',record_id:String(row.design_id),field:'image'}));
 const grants=useMediaGrants(refs,{enabled:refs.length>0});
 const query=useSquadQuery(['studio-branding-images',brandings,grants.data],async({signal})=>{
  const result=[];
  for(const row of brandings){
   signal.throwIfAborted();if(!row.design_id)continue;
   const ref={resource:'brandings',record_id:String(row.design_id),field:'image'};
   const grant=grants.data?.find(item=>referenceKey(item)===referenceKey(ref));
   if(grant?.status==='missing')continue;
   const url=grant?.status==='ready'&&safeMediaUrl(grant.url,getEnvironmentConfig(environment).url);
   if(!url)throw Error('Artwork is still being prepared.');
   const placement=studioArtworkPlacement(row.side??'',String(row.width),String(row.height));
   if(!placement)throw Error('This artwork placement has no verified 3D position.');
   if(!['image/png','image/jpeg','image/webp','image/gif'].includes(grant.content_type))throw Error('Use a PNG, JPEG or WebP artwork image for the 3D preview.');
   const response=await fetch(url,{signal,credentials:'omit',redirect:'error'});
   if(!response.ok)throw Error('Artwork could not be loaded.');
   const blob=await response.blob();if(blob.size>10*1024*1024)throw Error('Artwork exceeds the preview size limit.');
   const bitmap=await createImageBitmap(blob);
   try{signal.throwIfAborted();const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const dataUri=canvas.toDataURL('image/png');if(dataUri.length>2800000)throw Error('Artwork is too detailed for the 3D preview.');result.push({id:String(row.design_id),dataUri,...placement});}finally{bitmap.close();}
  }
  signal.throwIfAborted();return result;
 },{enabled:refs.length>0&&!grants.isLoading&&!grants.error,staleTime:60000,gcTime:120000,refetchOnWindowFocus:false});
 return {data:refs.length?query.data:[],pending:refs.length>0&&(grants.isLoading||query.isFetching),error:grants.error||query.error};
}
