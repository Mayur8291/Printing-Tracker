import React, {useState} from 'react';
import {Plus, Trash2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {MediaField} from '../../components/index.js';
import {useSquadCommand} from '../../data/hooks';
import {Field, Panel, SelectField} from '../orders/CommerceUI';

const specOf = value => Object.fromEntries(['type','side','width','height','unit','comment','print_area'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));

/** One editor for new quote placements and owned saved artwork. Existing media stays attached. */
export default function BrandingEditor({sdk,canWrite,value,onChange}) {
  const [editing,setEditing]=useState(null),[attachment,setAttachment]=useState(null);
  const saveDesign=useSquadCommand();
  async function attach(index) {
    const entry=value[index];
    if(entry.design_id){setAttachment(index);return;}
    try {
      const result=await saveDesign.run(command=>sdk.saveBranding({spec:specOf(entry)},command),{key:'branding.save',payload:{index,spec:specOf(entry)}});
      onChange(value.map((row,n)=>n===index?{...row,design_id:result.id,design_version:result.version}:row));setAttachment(index);
    }catch{/* The command error is shown below. */}
  }
  async function save(spec) {
    if(editing==='new'){onChange([...value,spec]);setEditing(null);return;}
    const entry=value[editing], merged={...entry,...spec};
    if(entry.design_id){
      if(!canWrite)throw new Error('This saved artwork is read-only in the current environment.');
      const result=await saveDesign.run(command=>sdk.saveBranding({id:entry.design_id,spec:specOf(merged)},command),{key:'branding.edit',payload:{id:entry.design_id,spec:specOf(merged)},expectedVersion:entry.design_version});
      merged.design_version=result.version;
    }
    onChange(value.map((row,index)=>index===editing?merged:row));setEditing(null);
  }
  return <Panel title="Branding" description="Add print or embroidery placements using dimensions in inches." actions={<div className="flex flex-wrap gap-2">{value.length>0&&<Button type="button" size="sm" variant="ghost" disabled={saveDesign.pending} onClick={()=>{onChange([]);setAttachment(null);}}>Reset placements</Button>}<Button type="button" size="sm" variant="outline" onClick={()=>{saveDesign.reset();setEditing('new');}} disabled={value.length>=20||saveDesign.pending}><Plus/>Add placement</Button></div>}>
    <div className="divide-y">{value.map((branding,index)=><div key={index} className="flex flex-wrap items-center gap-3 p-5"><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium capitalize">{branding.type} · {branding.side}</p><p className="mt-1 text-xs text-muted-foreground">{branding.width} × {branding.height} inches</p></div><div className="flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" size="sm" disabled={saveDesign.pending||Boolean(branding.design_id&&!canWrite)} onClick={()=>{saveDesign.reset();setEditing(index);}}>Edit placement</Button><Button type="button" variant="outline" size="sm" disabled={!canWrite||saveDesign.pending} onClick={()=>attach(index)}>Artwork</Button><Button type="button" variant="ghost" size="icon" disabled={saveDesign.pending} aria-label={`Remove ${branding.side} branding`} onClick={()=>{onChange(value.filter((_,n)=>n!==index));setAttachment(null);}}><Trash2/></Button></div></div>)}{!value.length&&<p className="p-5 text-sm text-muted-foreground">No branding placements added.</p>}</div>
    {saveDesign.error&&editing===null&&<p role="alert" className="px-5 pb-4 text-sm text-destructive">{saveDesign.error.message}</p>}
    {attachment!==null&&value[attachment]?.design_id&&<div className="space-y-4 border-t p-5"><div className="flex items-center justify-between"><h3 className="font-medium">{value[attachment].side} artwork</h3><Button type="button" size="sm" variant="ghost" onClick={()=>setAttachment(null)}>Close artwork</Button></div><div className="grid gap-5 lg:grid-cols-3">{[['image','Original design'],['mockup_image','Mockup'],['attachment','Additional file']].map(([field,label])=><MediaField key={`${value[attachment].design_id}:${field}`} target={{resource:'brandings',record_id:value[attachment].design_id,field}} label={label} canWrite={canWrite} onSaved={result=>onChange(value.map((row,index)=>index===attachment?{...row,design_version:result.entity_version}:row))}/>)}</div></div>}
    {editing!==null&&<PlacementDialog initial={editing==='new'?null:value[editing]} onClose={()=>setEditing(null)} onSave={save}/>}
  </Panel>;
}
function PlacementDialog({initial,onClose,onSave}) {
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  async function submit(event){event.preventDefault();if(pending)return;setPending(true);setError('');const spec={...Object.fromEntries(new FormData(event.currentTarget)),unit:'inch'};try{await onSave(spec);}catch(cause){setError(cause.code==='P0002'?'This artwork is linked to an order or is no longer editable. Your original placement and attachments have been kept.':cause.message||'The placement could not be saved.');}finally{setPending(false);}}
  return <Dialog open onOpenChange={open=>{if(!open&&!pending)onClose();}}><DialogContent className="squad-dialog sm:max-w-xl"><DialogHeader><DialogTitle>{initial?'Edit placement':'Add placement'}</DialogTitle><DialogDescription>{initial?.design_id?'Update this owned artwork without replacing its attached files. Order-linked artwork is protected.':'Choose the technique, placement and dimensions for this design.'}</DialogDescription></DialogHeader><form className="space-y-5" onSubmit={submit}><fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2"><SelectField label="Technique" name="type" defaultValue={initial?.type??'print'}><option value="print">Print</option><option value="embroidery">Embroidery</option></SelectField><Field label="Placement" name="side" defaultValue={initial?.side??''} placeholder="Front chest" required maxLength={80}/><Field label="Width (inches)" name="width" type="number" defaultValue={initial?.width??''} min="0.01" max="1000" step="0.01" required/><Field label="Height (inches)" name="height" type="number" defaultValue={initial?.height??''} min="0.01" max="1000" step="0.01" required/><div className="sm:col-span-2"><Field label="Comment / guidelines" hint="Saved with this artwork; separate from the item note."><Textarea name="comment" defaultValue={initial?.comment??''} maxLength={4000} rows={3}/></Field></div></fieldset>{error&&<p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending?'Saving…':initial?'Save placement':'Add placement'}</Button></DialogFooter></form></DialogContent></Dialog>;
}
