// Receives a real Python plan_fixture payload on stdin; no network or hosted writes.
import assert from 'node:assert/strict';
import {catalogueMediaCapability} from './web-catalogue-media-capability.mjs';
let input='';for await(const part of process.stdin)input+=part;const config=JSON.parse(input);input='';
const entries=[],clients=new Map([[3,{me:{id:config.fixture.actors['3'],role:3}}]]);
const create=()=>catalogueMediaCapability(config,clients,(kind,value)=>entries.push({kind,value}));
let cap=create();await cap.assertOwnedSetup();assert.deepEqual(cap.configuration,config.fixture.customConfig);assert.ok(config.fixture.commercialExtras.rmpClassId);assert.equal(config.fixture.ids.rmpClassId,undefined);
await assert.rejects(()=>cap.recordRoot('product','unexpected',{id:'unexpected'}));assert.equal(entries.at(-1).value.id,'unexpected');assert.equal(entries.at(-1).kind,'catalogue_media_observed_root');
cap=create();await cap.recordRoot('product','9007199254740997',{id:'9007199254740997'});await cap.recordRoot('product_image','9007199254740998',{record_id:'9007199254740998'});
await assert.rejects(()=>cap.recordReservation('00000000-0000-4000-8000-000000000001',{resource:'products',record_id:'1',field:'images'}));assert.equal(entries.at(-1).value.record_id,'1');
const uploadIds=['00000000-0000-4000-8000-000000000001'];await cap.recordReservation(uploadIds[0],{resource:'products',record_id:'9007199254740997',field:'images'});
if(config.web_catalogue_media.opaque){await cap.recordRoot('branding','9007199254740999',{id:'9007199254740999'});uploadIds.push('00000000-0000-4000-8000-000000000002');await cap.recordReservation(uploadIds[1],{resource:'brandings',record_id:'9007199254740999',field:'attachment'});}
const proof=await cap.verifyCleanupReady({uploadIds,productId:'9007199254740997'});assert.equal(proof.observations_only,true);assert.equal(proof.independent_server_cleanup_required,true);assert.ok(entries.every(e=>e.kind!=='entity'));
assert.throws(()=>catalogueMediaCapability({...config,web_catalogue_media:{...config.web_catalogue_media,legacy_id:'999'}},clients,()=>{}));
assert.throws(()=>catalogueMediaCapability({...config,web_catalogue_media:{...config.web_catalogue_media,configuration:{...config.fixture.customConfig,base_product_id:'999'}}},clients,()=>{}));
console.log(JSON.stringify({passed:true,checks:['actual_fixture_shape','root_journal_precedes_assertions','reservation_journal_precedes_assertions','large_decimal_strings','wrong_target_rejected','observations_never_authorize_cleanup','actor_and_config_bound']}));
