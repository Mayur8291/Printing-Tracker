import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBannerDestination} from './squad.js';

test('banner IDs remain exact decimal strings, with absent fields represented as null',()=>{
 assert.deepEqual(parseBannerDestination({category_id:'9007199254740993',brand_id:'20',class_id:3}),{categoryId:'9007199254740993',brandId:'20',classId:'3'});
 assert.deepEqual(parseBannerDestination({class_id:'9'}),{categoryId:null,brandId:null,classId:'9'});
 assert.deepEqual(parseBannerDestination({category_id:'4'}),{categoryId:'4',brandId:null,classId:null});
});
test('banner destinations fail when empty or any supplied ID is malformed',()=>{
 for(const value of [null,{}, {category_id:0},{brand_id:'01'},{class_id:'-1'},{category_id:'1.5'},{brand_id:'2&x=3'},{brand_id:' 2'}, {category_id:'3',class_id:''}])assert.equal(parseBannerDestination(value),null);
});
