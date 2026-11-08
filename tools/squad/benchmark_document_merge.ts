import {renderDocument,type Snapshot} from '../../supabase/functions/squad-jobs/documents-render.ts';
import {mergeDocument,digest,type DocumentStorage} from '../../supabase/functions/squad-jobs/documents.ts';
import {documentFonts} from '../../supabase/functions/squad-jobs/fonts/embedded.ts';
const snapshot:Snapshot={kind:'catalogue',document_id:'11111111-1111-4111-8111-111111111111',captured_at:'2026-11-08T06:00:00Z',template_version:'squad-documents-v1',presentation:{company_name:'Synthetic performance acceptance'},rows:Array.from({length:100},(_,i)=>({name:'Product '+i,brand:'Sample brand',category:'Sample category',color:'Navy',display_price:'125.25',mrp:'200.00',variants:[{size:'S'},{size:'M'},{size:'L'}]}))};
const start=performance.now();const chunk=await renderDocument(snapshot,{fonts:documentFonts(),asset:()=>{throw new Error('unexpected asset');}});const renderMs=performance.now()-start;
const parts=Array.from({length:20},(_,i)=>({path:'synthetic-'+i,bytes:chunk.bytes.length,sha256:'test',pages:chunk.pages}));
const storage:DocumentStorage={part:()=>Promise.resolve(chunk.bytes),asset:()=>{throw new Error('unexpected asset');},put:async()=>{}};
const mergeStart=performance.now(),output=await mergeDocument(snapshot,parts,storage);console.log(JSON.stringify({chunk_rows:100,chunk_pages:chunk.pages,chunk_wall_ms:renderMs,parts:20,merged_pages:output.pages,merge_wall_ms:performance.now()-mergeStart,merged_bytes:output.bytes.length,sha256:await digest(output.bytes)}));
