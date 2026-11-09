import {useEffect,useRef,useState} from 'react';
import {Camera,LoaderCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {useSquad,useSquadQuery} from '../../data/hooks';
import {capturePreview} from '../../components/capturePreview';
import {MediaField} from '../../components/Media';
import {CommandDialog,Field,Pager,Panel,QueryState} from '../orders/CommerceUI';

/** Media remains attached to the saved reusable product, including when that
 * product is reused for an order. No record or upload is created on mount. */
export default function ProductReferenceImages({productId,configurationCurrent,previewRef,reused=false}) {
  const {sdk,canWrite}=useSquad();
  const [stack,setStack]=useState([null]),[editing,setEditing]=useState(null),[prepared,setPrepared]=useState(null),[capturing,setCapturing]=useState(false),[error,setError]=useState('');
  const captureGeneration=useRef(0);const [uploading,setUploading]=useState(false);
  const query=useSquadQuery(['product-images',productId,stack.at(-1)],({sdk}) => sdk.productImages(productId,{cursor:stack.at(-1),limit:12}),{enabled:!!productId});
  useEffect(()=>{setPrepared(null);setEditing(null);setStack([null]);setError('');},[productId]);
  useEffect(()=>{captureGeneration.current++;if(!configurationCurrent)setPrepared(null);return()=>{captureGeneration.current++;};},[productId,configurationCurrent]);
  const writable=canWrite&&query.data?.can_edit===true&&configurationCurrent;
  const rows=query.data?.data??[];
  async function capture(){const token=++captureGeneration.current;setCapturing(true);setError('');try{const file=await capturePreview(previewRef.current);if(token===captureGeneration.current)setPrepared(file);}catch(error){setError(error.message);}finally{setCapturing(false);}}
  async function refresh(){setPrepared(null);if(stack.length>1)setStack([null]);else await query.refetch();}
  return <Panel title="Reference images" description="Keep the rendered design and supporting images with this reusable product."><div className="space-y-5 p-5">
    {!productId?<p className="text-sm leading-6 text-muted-foreground">Save the reusable design to attach its mockup and reference images. Each image can have its own production guidelines.</p>:<>
      {!configurationCurrent&&<p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">The configuration has changed. Save the current design before adding or changing its images.</p>}
      {reused&&<p className="text-sm leading-6 text-muted-foreground">This configuration reuses an existing design. Its images are shared wherever that design is used; existing images are kept.</p>}
      <QueryState query={query} empty={!rows.length} title="No reference images yet" description="Add a reference image or capture the current design preview."><div className="grid gap-5" style={{gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,280px),1fr))'}}>{rows.map(row=><article key={row.id} className="space-y-4 rounded-xl border p-4"><MediaField target={{resource:'product_images',record_id:row.id,field:'image'}} reference={row.image} label={`Reference image #${row.id}`} canWrite={writable} onSaved={refresh}/><div className="border-t pt-3"><p className="text-xs font-medium text-muted-foreground">Image guidelines</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{row.comment||'No guidelines added.'}</p>{row.comment_truncated&&<p className="mt-2 text-xs text-muted-foreground">The original guidelines are longer than 4,000 characters. Only the first 4,000 are displayed.</p>}<Button type="button" size="sm" variant="ghost" className="mt-2" disabled={!writable} onClick={()=>setEditing(row)}>Edit guidelines</Button></div></article>)}</div></QueryState>
      <Pager stack={stack} setStack={setStack} next={query.data?.next_cursor} fetching={query.isFetching} count={rows.length}/>
      <div className="space-y-4 rounded-xl border bg-muted/20 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-medium">Add an image</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Capture the current preview or choose your own reference image. Review the file, then upload it.</p></div><Button type="button" size="sm" variant="outline" disabled={!writable||capturing||uploading} onClick={capture}>{capturing?<LoaderCircle className="size-4 animate-spin"/>:<Camera className="size-4"/>}{capturing?'Preparing mockup…':'Capture design preview'}</Button></div>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<MediaField key={`${productId}:${configurationCurrent}`} target={{resource:'products',record_id:productId,field:'images'}} label="New reference image" canWrite={writable} allowDetach={false} preparedFile={prepared} onBusyChange={setUploading} onSaved={refresh}/></div>
    </>}
    {editing&&<CommandDialog title="Edit image guidelines" description={editing.comment_truncated?'The original guidelines exceed 4,000 characters. Saving replaces the full text with the text below.':'These instructions stay with this reference image.'} open onClose={()=>setEditing(null)} disabled={!writable} version={editing.version} onSubmit={(values,command)=>sdk.saveProductImageComment(editing.id,values.comment,command)} onSuccess={refresh}><input type="hidden" name="image_id" value={editing.id}/>{editing.comment_truncated&&<label className="flex items-start gap-3 text-sm"><input type="checkbox" required className="mt-1 size-4"/>I understand this replaces the full original guidelines.</label>}<Field label="Guidelines"><Textarea name="comment" defaultValue={editing.comment??''} maxLength={4000} rows={4}/></Field></CommandDialog>}
  </div></Panel>;
}
