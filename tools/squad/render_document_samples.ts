import {renderDocument, type Snapshot} from '../../supabase/functions/squad-jobs/documents-render.ts';
import {documentFonts} from '../../supabase/functions/squad-jobs/fonts/embedded.ts';
const root='tools/squad/private/documents';await Deno.mkdir(root,{recursive:true});
const base={document_id:'11111111-1111-4111-8111-111111111111',captured_at:'2026-11-08T06:00:00Z',template_version:'squad-documents-v1'};
const catalogue:Snapshot={...base,kind:'catalogue',rows:Array.from({length:7},(_,i)=>({class_id:String(i+1),name:'Classic cotton polo - '+(i+1),brand:'Sample brand',category:'Everyday essentials',color:'Navy blue',display_price:'224.50',mrp:'399.00',variants:[{size:'S'},{size:'M'},{size:'L'},{size:'XL'}]})),presentation:{company_name:'Sample Company / नमस्ते',company_desc:'Synthetic acceptance catalogue. No customer records.',display_stock:true,bank_details:true,full_name:'Sample account holder',account_no:'TEST-ONLY-0000',ifsc:'DEMO0000001',display_address:true,building_name:'Sample office',area:'Bengaluru',remarks:'Amounts are illustrative.',terms:'Prices are captured at the time of generation.\nThis is a synthetic demonstration. '.repeat(8)}};
const challan:Snapshot={...base,kind:'delivery_challan',rows:[{size:'M',quantity:3},{size:'L',quantity:2}],customer:{name:'Sample Customer',company:'Sample Company',phone:'TEST ONLY',gst_no:'DEMO'},order_id:'1001',item_id:'1001',dispatch_id:'123',dispatched_at:'2026-11-07T08:00:00Z',destination:{mode:'customer',address:{address:'Sample address',city:'Bengaluru',state:'Karnataka',zip_code:'TEST'}},destination_basis:'dispatch_snapshot',quantity:5,unit_price:'100.00',subtotal:'500.00',cgst:'12.50',sgst:'12.50',igst:'0.00',total:'525.00'};
const tailor:Snapshot={...base,kind:'tailor_weekly',tailor_id:'105',period:{week_start:'2026-10-24',week_end:'2026-10-30'},rows:[{product_name:'Oxford shirt',item_id:'1001',tailor_id:'105',assigned:10,completed:6,pending:4,unit_rate:'35.00',amount:'210.00'}],summary:{completed:6,pending:4,amount:'210.00',needs_reconciliation:false}};
for(const snapshot of [catalogue,challan,tailor]){
 const start=performance.now(),result=await renderDocument(snapshot,{fonts:documentFonts(),asset:()=>{throw new Error('No images expected');}});
 await Deno.writeFile(root+'/'+snapshot.kind+'.pdf',result.bytes);console.log(JSON.stringify({kind:snapshot.kind,pages:result.pages,bytes:result.bytes.length,wall_ms:performance.now()-start}));
}
for(const count of [100,500,2000]){
 const snapshot={...catalogue,rows:Array.from({length:count},(_,i)=>({...catalogue.rows[0],name:'Catalogue item '+i}))};const start=performance.now();
 const result=await renderDocument(snapshot,{fonts:documentFonts(),asset:()=>{throw new Error('No images expected');}});console.log(JSON.stringify({benchmark_rows:count,pages:result.pages,bytes:result.bytes.length,wall_ms:performance.now()-start}));
}
