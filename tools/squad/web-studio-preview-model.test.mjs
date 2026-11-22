import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveStudioDesign,STUDIO_BINDINGS} from '../../apps/admin/src/squad/features/studio/studio-catalogue.generated.js';
import {createStudioFixture} from './fixtures/product-studio/api.mjs';
const source=JSON.parse(fs.readFileSync(new URL('./fixtures/product-studio/catalogue.json',import.meta.url)));
const {readOptions}=createStudioFixture({catalogue:source,assets:{}});
const colors=(kind,parentId,partId)=>readOptions(kind,{parentId,partId});
const fabric=source.fabrics.find(f=>colors('fabric_colors',f.id).some(c=>c.hex));
const body=colors('fabric_colors',fabric.id).find(c=>c.hex);
const catalogue={parts:source.parts,fabricColors:colors('fabric_colors',fabric.id),addonsByPart:{},partColorsByPart:{},addonColorsByAddon:{}};
for(const p of source.parts){
 catalogue.partColorsByPart[p.id]=colors('part_colors',p.id);
 catalogue.addonsByPart[p.id]=readOptions('addons',{parentId:p.id});
 for(const a of catalogue.addonsByPart[p.id])if(a.has_color)catalogue.addonColorsByAddon[`${p.id}:${a.id}`]=colors('addon_colors',a.id,p.id);
}
const input={projectRef:'levwrmvqdntngeasrtnb',selection:{base:{id:'216'},designCategory:{id:'25'},fabric:{id:fabric.id},color:{id:body.id}},catalogue,parts:[]};
const partColor=id=>catalogue.partColorsByPart[id].find(c=>c.hex)?.id;
for(const p of source.parts)test(`${p.name}: unfinished colour stays a 3D draft without changing the saved intent`,()=>{
 const draft={...input,parts:[{part_id:p.id,color_id:'',addons:[]}]},before=JSON.stringify(draft);
 assert.equal(resolveStudioDesign(draft).status,'unsupported');
 const result=resolveStudioDesign({...draft,previewIncomplete:true});
 assert.equal(result.status,'incomplete');assert.equal(result.pendingFields.length,1);assert(result.design.visibleGroups.includes('Body_Closed'));
 assert.equal(JSON.stringify(draft),before);
 assert.equal(resolveStudioDesign({...draft,parts:[{...draft.parts[0],color_id:partColor(p.id)}],previewIncomplete:true}).status,'supported');
});
test('invalid nonempty part and addon colour IDs never become silently inherited colours',()=>{
 const part={part_id:'192',color_id:'invalid',addons:[]};
 assert.equal(resolveStudioDesign({...input,parts:[part],previewIncomplete:true}).status,'unsupported');
 part.color_id=partColor(part.part_id);part.addons=[{addon_id:'748',color_id:'invalid'}];
 assert.equal(resolveStudioDesign({...input,parts:[part],previewIncomplete:true}).status,'unsupported');
 part.addons[0].color_id='';assert.equal(resolveStudioDesign({...input,parts:[part],previewIncomplete:true}).status,'incomplete');
});
test('changing fabric with a cleared colour keeps mapped geometry incomplete, not unsupported',()=>{
 const p={part_id:'217',color_id:partColor('217'),addons:[{addon_id:STUDIO_BINDINGS.find(b=>b.length==='full').id}]};
 const result=resolveStudioDesign({...input,selection:{...input.selection,color:undefined},parts:[p],previewIncomplete:true});
 assert.equal(result.status,'incomplete');assert(result.design.visibleGroups.some(g=>g===`Addon_${p.addons[0].addon_id}`));
});
test('all 59 verified catalogue bindings still resolve in 3D with compatible sleeve lengths',()=>{
 assert.equal(STUDIO_BINDINGS.length,59);
 for(const binding of STUDIO_BINDINGS){
  const addon={addon_id:binding.id,...(binding.has_color?{color_id:catalogue.addonColorsByAddon[`${binding.part_id}:${binding.id}`]?.find(c=>c.hex)?.id}:{})};
  const parts=[{part_id:binding.part_id,color_id:partColor(binding.part_id),addons:[addon]}];
  if(binding.requiresLength){const length=STUDIO_BINDINGS.find(b=>b.length===binding.requiresLength);parts.push({part_id:length.part_id,color_id:partColor(length.part_id),addons:[{addon_id:length.id,...(length.has_color?{color_id:catalogue.addonColorsByAddon[`${length.part_id}:${length.id}`]?.find(c=>c.hex)?.id}:{})}]});}
  const result=resolveStudioDesign({...input,parts,previewIncomplete:true});assert.equal(result.status,'supported',`${binding.id}: ${result.reason}`);
  assert(result.design.visibleGroups.includes(binding.modelGroup));
 }
});
test('incomplete editing mode does not accept conflicting or unknown geometry',()=>{
 const p={part_id:'217',color_id:'',addons:STUDIO_BINDINGS.filter(b=>b.length).slice(0,2).map(b=>({addon_id:b.id}))};
 assert.equal(resolveStudioDesign({...input,parts:[p],previewIncomplete:true}).status,'unsupported');
 assert.equal(resolveStudioDesign({...input,parts:[{part_id:'not-a-part',color_id:'',addons:[]}],previewIncomplete:true}).status,'unsupported');
});

test('a new design keeps a neutral 3D draft but cannot be captured as a complete product',()=>{
 const result=resolveStudioDesign({...input,selection:{base:{id:'216'}},previewIncomplete:true});
 assert.equal(result.status,'incomplete');assert.equal(result.pendingFields.length,3);
 assert(result.design.visibleGroups.includes('Body_Closed'));
});
