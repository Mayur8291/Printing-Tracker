/** Browser observations are a durable diagnostic journal, never cleanup authority.
 * Python independently proves the immutable command/audit/source/Storage binding.
 */
import assert from 'node:assert/strict';
export function catalogueMediaCapability(config,clients,log){
 const proof=config.web_catalogue_media,actor=config.actors.find(a=>a.role===3),roots=new Map(),reserved=[];
 assert.ok(proof&&actor);assert.equal(proof.actor_id,actor.auth_id);assert.equal(proof.legacy_id,String(config.fixture.actors['3']));
 assert.deepEqual(proof.configuration,config.fixture.customConfig);assert.equal(typeof proof.opaque,'boolean');assert.equal(proof.files.length,proof.opaque?2:1);
 assert.deepEqual(proof.branding_spec,proof.opaque?{type:'print',side:'front',width:'3',height:'2',unit:'inch',comment:config.fixture.label}:null);
 const decimal=/^[1-9]\d{0,18}$/,uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 return {role:3,configuration:proof.configuration,opaque:proof.opaque,brandingSpec:proof.branding_spec,files:proof.files,
  assertOwnedSetup:async()=>{assert.equal(clients.get(3).me.id,proof.legacy_id);assert.equal(clients.get(3).me.role,3);},
  recordRoot:async(kind,id,response)=>{
   // Retain the observed identifier before assertions, including an unexpected
   // response. IDs alone are deliberately not entered as trusted deletion roots.
   log('catalogue_media_observed_root',{kind:String(kind).slice(0,40),id:String(id).slice(0,80),response_id:String(response?.id??response?.record_id).slice(0,80)});
   assert.ok(['product','product_image','branding'].includes(kind));assert.match(id,decimal);assert.ok(!roots.has(kind));
   assert.equal(response?.id??response?.record_id,id);assert.ok(kind!=='branding'||proof.opaque);roots.set(kind,id);
  },
  recordReservation:async(id,target)=>{
   log('catalogue_media_observed_upload',{id:String(id).slice(0,80),resource:String(target?.resource).slice(0,40),record_id:String(target?.record_id).slice(0,80),field:String(target?.field).slice(0,40)});
   assert.match(id,uuid);assert.ok(!reserved.includes(id)&&reserved.length<proof.files.length);
   assert.deepEqual(target,reserved.length===0?{resource:'products',record_id:roots.get('product'),field:'images'}:{resource:'brandings',record_id:roots.get('branding'),field:'attachment'});reserved.push(id);
  },
  verifyCleanupReady:async({uploadIds,productId})=>{
   assert.deepEqual(uploadIds,reserved);assert.equal(reserved.length,proof.files.length);assert.equal(productId,roots.get('product'));assert.ok(roots.has('product_image'));assert.equal(roots.has('branding'),proof.opaque);
   return {passed:true,observations_only:true,product_id:productId,branding_id:roots.get('branding')??null,independent_server_cleanup_required:true};
  }
 };
}
