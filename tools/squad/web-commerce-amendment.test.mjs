import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAmendmentSelection,amendmentLineState} from '../../apps/admin/src/squad/features/catalogue/amendmentModel.js';
const config={base_product_id:'1',fabric_id:'2',fabric_color_id:'3',category_id:'4',parts:[]};
function fixture({rmp=false,sample=false,branding=false}={}){
 const item={id:'9007199254740995',version:'8:2',type:rmp?1:0,product_id:'42',total_quantity:sample?1:6,sample_order:sample,size_type:'Regular fit',comment:'Keep my note'};
 const order={id:'77',version:'8:4',items:{data:[item],next_cursor:null}},calls=[];
 const sections={quantities:[{size_id:'9007199254740997',quantity:sample?1:6}],bulk_plan:[{size_id:'9007199254740998',quantity:12}],brandings:branding?[{id:'91',version:'8:6',type:0,side:'front',width:'2.5',height:'3',unit:'inch',image:{status:'ready'}}]:[],variants:[{sku_id:'9007199254740999',quantity:6}]};
 const sdk={order:async()=>structuredClone(order),presets:async()=>({data:[{id:'42',configuration:config}]}),configuratorOptions:async()=>({data:[{id:'9007199254740996',name:'Regular fit'}],next_cursor:null}),orderItem:async(id,section,page)=>{calls.push([id,section,page]);return {...item,product:{name:'Original garment'},records:{data:structuredClone(sections[section]),next_cursor:null,basis:section==='variants'?'accepted_quote':undefined}};}};
 return {sdk,order,item,sections,calls};
}
test('prefill preserves canonical sizes, unique historical size type, notes and versioned design',async()=>{
 const f=fixture({branding:true}),[row]=await loadAmendmentSelection(f.sdk,f.order);
 assert.equal(row.line.quantities[0].size_id,'9007199254740997');assert.equal(row.settings.size_type_id,'9007199254740996');assert.equal(row.settings.comment,'Keep my note');assert.equal(row.line.brandings[0].design_id,'91');assert.equal(row.line.brandings[0].design_version,'8:6');assert.equal(amendmentLineState(row),'Preserved');
 row.line.quantities[0].quantity=8;assert.equal(amendmentLineState(row),'Changed');assert.ok(f.calls.every(([, ,page])=>page.limit===100));
});
test('sample preservation keeps bulk size plan separate from ordered sample size',async()=>{const f=fixture({sample:true}),[row]=await loadAmendmentSelection(f.sdk,f.order);assert.deepEqual(row.line.quantities,[{size_id:'9007199254740998',quantity:12}]);assert.deepEqual(row.line.sample,{size_id:'9007199254740997',quantity:1});});
test('ready-made prefill uses recorded SKU rather than canonical size IDs',async()=>{const f=fixture({rmp:true}),[row]=await loadAmendmentSelection(f.sdk,f.order);assert.deepEqual(row.line.skus,[{sku_id:'9007199254740999',quantity:6}]);assert.equal(row.settings.size_type_id,undefined);});
test('legacy RMP without receipt fails explicitly without partial replacement',async()=>{const f=fixture({rmp:true}),read=f.sdk.orderItem;f.sdk.orderItem=async(...args)=>{const r=await read(...args);if(args[1]==='variants')r.records={data:[],next_cursor:null,basis:'not_recorded_in_source'};return r;};await assert.rejects(loadAmendmentSelection(f.sdk,f.order),/no recorded SKU selection/);});
test('ambiguous size types, unavailable art, truncated note and stale item are not silently replaced',async()=>{
 let f=fixture();f.sdk.configuratorOptions=async()=>({data:[{id:'1',name:'Regular fit'},{id:'2',name:'Regular fit'}]});await assert.rejects(loadAmendmentSelection(f.sdk,f.order),/missing or ambiguous/);
 f=fixture({branding:true});f.sections.brandings[0].image.status='missing';await assert.rejects(loadAmendmentSelection(f.sdk,f.order),/image is unavailable/);
 f=fixture();f.item.comment_truncated=true;await assert.rejects(loadAmendmentSelection(f.sdk,f.order),/note too long/);
 f=fixture();const read=f.sdk.orderItem;f.sdk.orderItem=async(...args)=>({...await read(...args),version:'8:3'});await assert.rejects(loadAmendmentSelection(f.sdk,f.order),/changed while loading/);
});
test('bounded child paging reads complete plan and rejects total mismatch',async()=>{
 const f=fixture(),read=f.sdk.orderItem;f.sdk.orderItem=async(id,section,page)=>{const r=await read(id,section,page);if(section==='quantities')r.records={data:[{size_id:page.cursor?'8':'9',quantity:3}],next_cursor:page.cursor?null:'next'};return r;};const [row]=await loadAmendmentSelection(f.sdk,f.order);assert.equal(row.line.quantities.length,2);
 f.item.total_quantity=8;await assert.rejects(loadAmendmentSelection(f.sdk,f.order),/do not reconcile/);
});
