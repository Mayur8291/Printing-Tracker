import test from 'node:test';
import assert from 'node:assert/strict';
import {previewGeometry,previewLayers,previewColor} from './configuratorPreviewModel.js';
test('Flutter square-relative translation, reciprocal height, and centered mirror',()=>{
 assert.deepEqual(previewGeometry({offset_x:'.2',offset_y:'-.05',height_ratio:'2',mirror_offset_x:'.7'}),{left:'20%',top:'-5%',height:'50%',transform:undefined});
 assert.deepEqual(previewGeometry({offset_y:'.1',height_ratio:'4',mirror_offset_x:'.7'},true),{left:'70%',top:'10%',height:'25%',transform:'scaleX(-1)'});
 for(const height_ratio of [null,'0','-1','NaN'])assert.throws(()=>previewGeometry({height_ratio}));
});
test('base then sorted ordinary addons then all mirrored addons; -1 disables mirror',()=>{
 const layer=(id,sort,mirror)=>({id,layerSort:sort,asset:{mirror_offset_x:mirror}});
 assert.deepEqual(previewLayers([layer('base',0,null)],[layer('late',8,'0'),layer('early',2,'-1'),layer('mid',4,'.6')]).map(x=>[x.id,x.mirror]),[['base',false],['early',false],['mid',false],['late',false],['mid',true],['late',true]]);
});
test('color values cannot inject markup or CSS',()=>{assert.equal(previewColor('#ab12ef'),'#ab12ef');assert.equal(previewColor(null),null);for(const v of ['red;fill:url(https://x)','<svg>','#ffffffff'])assert.throws(()=>previewColor(v));});
