import {useEffect,useRef,useState} from 'react';
import {Camera,Plus,Trash2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Panel} from '../orders/CommerceUI';
import {capturePreview} from '../../components/capturePreview';
import ImageCropDialog from '../../components/ImageCropDialog';
import {stageReference,listReferences,readReference,removeReference} from './stagedReferences';

export default function StagedReferenceImages({scope,previewRef,value,onChange,onReady,disabled,onBusyChange}){
 const callback=useRef(onBusyChange);callback.current=onBusyChange;
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[crop,setCrop]=useState(null);const input=useRef(null),owner=useRef(scope);owner.current=scope;
 useEffect(()=>{callback.current?.(busy||!!crop);},[busy,crop]);
 useEffect(()=>()=>callback.current?.(false),[]);
 useEffect(()=>{let live=true;onReady(false);listReferences(scope).then(rows=>{if(live){onChange(rows);onReady(true);}}).catch(cause=>{if(live){setError(cause.message);onReady(true);}});return()=>{live=false;};},[scope]);
 async function stage(file){if(!file)return;setBusy(true);setError('');try{if(value.length>=12)throw Error('You can attach up to 12 reference images.');const row=await stageReference(scope,file);if(owner.current===scope)onChange([...value,row]);}catch(cause){setError(cause.message);}finally{setBusy(false);}}
 async function capture(){setBusy(true);setError('');try{await stage(await capturePreview(previewRef.current));}catch(cause){setError(cause.message);}finally{setBusy(false);}}
 async function remove(id){setBusy(true);try{await removeReference(scope,id);if(owner.current===scope)onChange(value.filter(row=>row.id!==id));}catch(cause){setError(cause.message);}finally{setBusy(false);}}
 return <Panel title="Reference images" description="Capture your garment or add supporting images now. They are attached when you save this design."><div className="space-y-4 p-5"><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={disabled||busy} onClick={capture}><Camera/>Capture design</Button><Button type="button" variant="outline" disabled={disabled||busy} onClick={()=>input.current?.click()}><Plus/>Add reference image</Button><input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)setCrop(file);}}/></div>{value.map(row=><div key={row.id} className="flex items-center gap-3 rounded-xl border p-3"><ReferenceThumbnail scope={scope} row={row}/><span className="min-w-0 flex-1 break-words text-sm">{row.name}</span><Button aria-label={`Remove ${row.name}`} type="button" size="icon" variant="ghost" disabled={disabled||busy} onClick={()=>remove(row.id)}><Trash2/></Button></div>)}{busy&&<p role="status" className="text-sm">Preparing reference image…</p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{value.length>0&&<p className="text-xs text-muted-foreground">{value.length} image{value.length===1?'':'s'} retained in this browser for up to 12 hours. Save the design to keep them in your account.</p>}</div>{crop&&<ImageCropDialog file={crop} onClose={()=>setCrop(null)} onApply={stage}/>}</Panel>;
}
function ReferenceThumbnail({scope,row}){const [url,setUrl]=useState(null);useEffect(()=>{let live=true,objectUrl;readReference(scope,row.id).then(file=>{objectUrl=URL.createObjectURL(file);if(live)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl);}).catch(()=>{});return()=>{live=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[scope,row.id]);return url?<img className="h-16 w-16 rounded-lg object-contain" src={url} alt={row.name}/>:<div className="h-16 w-16 animate-pulse rounded-lg bg-muted"/>;}
