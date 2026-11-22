import test from 'node:test';import assert from 'node:assert/strict';
import {draftKey,readDraft,writeDraft,clearDraft} from './studioDraft.js';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}};
test('draft isolation and media redaction survive restore',()=>{const s=storage(),key=draftKey('staging','1','3','216');writeDraft(key,{configuration:{base_product_id:'216',parts:[]},brandings:[{type:'print',design_id:'10',side:'Front',url:'secret',dataUri:'private'}]},s);assert.deepEqual(readDraft(key,s).brandings,[{type:'print',design_id:'10',side:'Front'}]);assert.equal(readDraft(draftKey('staging','1','4','216'),s),null);clearDraft(key,s);assert.equal(readDraft(key,s),null)});
test('expired and malformed drafts never restore',()=>{const s=storage();s.setItem('expired',JSON.stringify({v:1,savedAt:0,configuration:{base_product_id:'216',parts:[]}}));s.setItem('bad','{');assert.equal(readDraft('expired',s),null);assert.equal(readDraft('bad',s),null)});

test('malformed recovered part cannot crash the studio renderer',()=>{const s=storage();s.setItem('bad-part',JSON.stringify({v:1,savedAt:Date.now(),configuration:{base_product_id:'216',parts:[{part_id:'202'}]}}));assert.equal(readDraft('bad-part',s),null);});
