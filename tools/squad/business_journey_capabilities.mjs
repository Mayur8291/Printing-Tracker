/** One shared capability journey for Job Worker and Team.
 * Exercises current database authority through the shared SDK. Catalogue PDFs
 * remain queued download intents: this module never runs a worker or provider.
 */
import assert from 'node:assert/strict';
import {SquadError} from '../../packages/shared/squad.js';

const denied = (...kinds) => error => error instanceof SquadError && kinds.includes(error.kind);
const command = (ctx,label,expectedVersion=null) => ({expectedVersion,idempotencyKey:ctx.commandKey(`capabilities.${label}`)});
const own = (ctx,kind,id) => {assert.ok(id);ctx.record?.(kind,String(id));return String(id);};

export async function runJourney(ctx) {
  const admin=ctx.clients.get(0)?.sdk, f=ctx.fixture;
  assert.ok(admin && f.customConfig && f.ids.baseProductId && f.commercialExtras?.rmpClassId);
  const checks=[],entities={presetIds:[],documentIds:[]},results=[];
  const documentRequest={selection:{class_ids:[String(f.commercialExtras.rmpClassId)]},company_name:f.label,delivery:'download'};

  // The scenario is shared; only the subject and its existing notes/goals differ.
  for(const role of [11,12]) {
    const entry=ctx.clients.get(role),sdk=entry?.sdk,subject=String(entry?.me.id);
    assert.ok(sdk && subject!=='undefined');
    const prefix=`role-${role}`,name=f.label+' '+prefix+' product';
    const initial=await sdk.me();
    const base=['notes','goals'].flatMap((cap,index)=>initial.capabilities[cap]?[{key:String(index+1),checked:true}]:[]);
    const features=children=>children===null?base:[...base,{key:'3',checked:true,children:children.map(key=>({key,checked:true}))}];
    const grant=async(children,label)=>{
      const current=await admin.person(subject);
      return admin.saveCapabilities(subject,features(children),f.label+' '+label,command(ctx,`${prefix}-${label}`,current.version));
    };
    const capabilities=async(catalogue,configure,documents)=>{
      const current=await sdk.me();
      assert.equal(current.capabilities.catalogue,catalogue);
      assert.equal(current.capabilities.configure,configure);
      assert.equal(current.capabilities.documents,documents);
      assert.equal(current.capabilities.place_orders,false,'Product grants do not create order-placement authority');
      for(const cap of ['notes','goals'])assert.equal(current.capabilities[cap],initial.capabilities[cap]);
    };

    await grant(null,'products-off');
    await capabilities(false,false,false);
    await assert.rejects(sdk.catalogue('products',{search:f.label},{limit:2}),denied('forbidden'));
    await assert.rejects(sdk.configureProduct(f.customConfig,name,'',ctx.commandKey(`capabilities.${prefix}-configure-off`)),denied('forbidden'));
    await assert.rejects(sdk.requestDocument('catalogue',documentRequest,ctx.commandKey(`capabilities.${prefix}-pdf-off`)),denied('forbidden'));
    const selfVersion=(await admin.person(subject)).version;
    await assert.rejects(sdk.saveCapabilities(subject,features(['3.2','3.3']),f.label,command(ctx,`${prefix}-self-grant`,selfVersion)),denied('forbidden'));
    checks.push(`${prefix}_products_and_pdf_default_denial_and_no_self_grant`);

    await grant([],'browse-only');
    await capabilities(true,false,false);
    const catalogue=await sdk.catalogue('products',{search:f.label},{limit:2});
    assert.ok(catalogue.data.some(row=>row.id===String(f.ids.baseProductId)));
    assert.equal((await sdk.baseProduct(String(f.ids.baseProductId))).id,String(f.ids.baseProductId));
    await assert.rejects(sdk.configureProduct(f.customConfig,name,'',ctx.commandKey(`capabilities.${prefix}-browse-cannot-configure`)),denied('forbidden'));
    await assert.rejects(sdk.requestDocument('catalogue',documentRequest,ctx.commandKey(`capabilities.${prefix}-browse-cannot-pdf`)),denied('forbidden'));
    checks.push(`${prefix}_browse_grant_does_not_imply_configuration_or_pdf`);

    await grant(['3.3'],'configure-only');
    await capabilities(true,true,false);
    const presetKey=ctx.commandKey(`capabilities.${prefix}-preset`);
    const preset=await sdk.configureProduct(f.customConfig,name,'',presetKey);
    entities.presetIds.push(own(ctx,'preset',preset.id));
    assert.deepEqual(await sdk.configureProduct(f.customConfig,name,'',presetKey),preset);
    const presets=await sdk.presets({id:preset.id},{limit:1});
    assert.equal(presets.data.length,1);assert.equal(presets.data[0].id,preset.id);assert.equal(presets.next_cursor,null);
    await assert.rejects(sdk.requestDocument('catalogue',documentRequest,ctx.commandKey(`capabilities.${prefix}-configure-cannot-pdf`)),denied('forbidden'));

    await grant(['3.2'],'pdf-only');
    await capabilities(true,false,true);
    await assert.rejects(sdk.configureProduct(f.customConfig,name,'',presetKey),denied('forbidden'));
    await assert.rejects(sdk.presets({id:preset.id}),denied('forbidden'));
    const documentKey=ctx.commandKey(`capabilities.${prefix}-document`);
    const document=await sdk.requestDocument('catalogue',documentRequest,documentKey);
    entities.documentIds.push(own(ctx,'document',document.id));
    assert.equal(document.kind,'catalogue');assert.equal(document.state,'queued');
    assert.deepEqual(await sdk.requestDocument('catalogue',documentRequest,documentKey),document);
    await assert.rejects(sdk.requestDocument('catalogue',{...documentRequest,company_name:f.label+' changed'},documentKey),denied('validation'));
    const view=await sdk.document(document.id);
    assert.equal(view.state,'queued');assert.equal(view.delivery,'download');assert.equal(view.delivery_state,'not_requested');
    assert.equal(view.completed_parts,0);assert.equal(view.pages,null);assert.equal(view.bytes,null);
    for(const field of ['request','snapshot','object_path','url'])assert.ok(!Object.hasOwn(view,field));
    assert.ok((await sdk.documents({kind:'catalogue',state:'queued'},{limit:10})).data.some(row=>row.id===document.id));
    checks.push(`${prefix}_configuration_and_pdf_are_independent_with_retry_safe_owned_intents`);

    await grant(['3.2','3.3'],'combined');
    await capabilities(true,true,true);
    assert.equal((await sdk.presets({id:preset.id},{limit:1})).data[0].id,preset.id);
    assert.equal((await sdk.document(document.id)).state,'queued');
    results.push({role,sdk,grant,capabilities,preset,presetKey,name,document,documentKey});
  }

  // Both subjects now have identical capabilities; owner checks must still hold.
  assert.notEqual(results[0].preset.id,results[1].preset.id);
  for(const subject of results) {
    const other=results.find(row=>row.role!==subject.role);
    await assert.rejects(subject.sdk.document(other.document.id),denied('not_found'));
    assert.ok(!(await subject.sdk.documents({kind:'catalogue'},{limit:10})).data.some(row=>row.id===other.document.id));
    // No token refresh occurs between permission updates and these reads/retries.
    await subject.grant(null,'revoke-products');
    await subject.capabilities(false,false,false);
    await assert.rejects(subject.sdk.baseProduct(String(f.ids.baseProductId)),denied('forbidden'));
    await assert.rejects(subject.sdk.configureProduct(f.customConfig,subject.name,'',subject.presetKey),denied('forbidden'));
    await assert.rejects(subject.sdk.requestDocument('catalogue',documentRequest,subject.documentKey),denied('forbidden'));
    await assert.rejects(subject.sdk.document(subject.document.id),denied('not_found'));
    assert.ok(!(await subject.sdk.documents({kind:'catalogue'},{limit:10})).data.some(row=>row.id===subject.document.id));
    checks.push(`role-${subject.role}_document_owner_scope_and_current_session_revocation`);
  }
  return {checks,entities,scope:'Shared Job Worker/Team product and PDF grants, immediate revocation, owner isolation and queued download intents. Rendering, Storage download and delivery are separate worker acceptance.'};
}
