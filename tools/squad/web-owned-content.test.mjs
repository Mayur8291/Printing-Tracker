import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverOwnedContent} from './web-content-media-hosted-journey.mjs';
const plan={format:'squad-web-content-fixture/v1',sha256:'1'.repeat(64),bytes:180,class_id:'104',ready_id:'300',missing_id:'301',product_name:'Owned class',ready_name:'Owned ready',missing_name:'Owned missing',category:'Owned category',upload_date:'2026-11-09'};
function fixture(){
 const calls=[];const ref=(resource,id,field)=>({resource,record_id:id,field,pointer:''});
 const product={id:'104',name:plan.product_name,images:[ref('rmp_classes','104','image_1')]};
 const promotions=[{id:'300',name:plan.ready_name,content:{kind:'file',media:ref('promotions','300','link')}},{id:'301',name:plan.missing_name,content:{kind:'file',media:ref('promotions','301','link')}}];
 const sdk={readyMade:async(f,c,p)=>{calls.push(['products',f,c,p]);return{data:[product],next_cursor:null}},promotions:async(f,p)=>{calls.push(['promotions',f,p]);return{data:promotions,next_cursor:null}},mediaGrants:async refs=>({references:refs.map(r=>({...r,status:r.record_id==='301'?'missing':'ready',bytes:'180',content_type:'image/png',url:'https://scvojtvgnkmbupvyslmb.supabase.co/storage/v1/object/sign/canto-media/owned?token=local'}))})};return{sdk,calls,product,promotions};
}
test('owned discovery binds exact existing class, category/day and exactly two promotions',async()=>{const f=fixture(),result=await discoverOwnedContent(f.sdk,'3',plan);assert.equal(result.products.usable.product.id,'104');assert.equal(result.promotions.usable.item.id,'300');assert.equal(result.promotions.missing.item.id,'301');assert.deepEqual(f.calls,[['products',{search:plan.product_name},'3',{limit:20}],['promotions',{category:plan.category,upload_date:plan.upload_date},{limit:12}]]);});
test('wrong class and unexpected promotion cannot become a download oracle',async()=>{let f=fixture();f.product.id='105';await assert.rejects(discoverOwnedContent(f.sdk,'3',plan));f=fixture();f.promotions.push({...f.promotions[0],id:'999'});await assert.rejects(discoverOwnedContent(f.sdk,'3',plan));});
test('wrong project ready grant is rejected',async()=>{const f=fixture();f.sdk.mediaGrants=async refs=>({references:refs.map(r=>({...r,status:'ready',bytes:'180',content_type:'image/png',url:'https://foreign.supabase.co/storage/v1/object/sign/canto-media/x'}))});await assert.rejects(discoverOwnedContent(f.sdk,'3',plan));});
