import test from 'node:test';
import assert from 'node:assert/strict';
import {priceSum,priceDifference,priceMoney,optionPriceLabel,readPricePreviews,readOptionPriceDifferences,quotePriceChanges} from './pricing.js';
const config={base_product_id:'1',fabric_id:'2',fabric_color_id:'3',category_id:'4',parts:[]};
const price=(quantity,unit='10')=>({quantity,unit_price:unit,branding_unit_price:'0',subtotal:'10',branding_total:'0',total:'10',sample_rate_applied:quantity<6,rate_available:true});
const response=request=>({purpose:'custom_price_preview',currency:'INR',tax_included:false,context:{customer_id:'103',generation:1},scenarios:request.scenarios.map((selection,i)=>({index:i+1,selection,prices:[price(selection.quantity,String(10+i))]}))});
const input=(request,transform=x=>x)=>({client:{withSignal:()=>({previewCustomPrices:async r=>transform(response(r))})},request,signal:new AbortController().signal,isCurrent:()=>true,customerId:'103',generation:'1'});
test('decimal calculations preserve fractions and large amounts without floating point',()=>{
 assert.equal(priceSum('0.1','0.2'),'0.3');assert.equal(priceDifference('100.001','100'),'0.001');
 assert.equal(priceMoney('12345678901234567890.995'),'₹12,345,678,901,234,567,891.00');
 assert.equal(priceMoney('-0.005'),'-₹0.01');assert.throws(()=>priceMoney('NaN'));
});
test('sample choices are not advertised as free and removal is explicit',()=>{
 assert.equal(optionPriceLabel(price(1),price(1)),'No change at sample rate');
 assert.equal(optionPriceLabel(price(6,'12'),price(6,'10'),true),'Remove: -₹2.00 / piece');
 assert.equal(optionPriceLabel(price(6,'10'),price(6,'12')),'+₹2.00 / piece');
});
test('preview binds account, generation, quantity, configuration and sample mode',async()=>{
 const request={scenarios:[{configuration:config,quantity:6}]};
 await readPricePreviews(input(request));
 for(const mutate of [r=>{r.context.customer_id='104'},r=>{r.context.generation=2},r=>{r.scenarios[0].prices[0].quantity=7},r=>{r.scenarios[0].prices[0].sample_rate_applied=true},r=>{r.scenarios[0].prices[0].total='NaN'},r=>{r.scenarios[0].selection={...r.scenarios[0].selection,quantity:8}}]){
  await assert.rejects(readPricePreviews(input(request,r=>{mutate(r);return r})));
 }
 const revoked=input(request);revoked.isCurrent=()=>false;await assert.rejects(readPricePreviews(revoked));
});
test('single choice replaces its group and removes dependent sleeve details; multi toggles one',async()=>{
 const length={id:'10',name:'Sleeve Length'},type={id:'11',name:'Sleeve Type'};
 const choices=[{id:'1',name:'Half Sleeve',selection_type:0,group:'length',has_color:false},{id:'2',name:'Full Sleeve',selection_type:0,group:'length',has_color:false},{id:'3',name:'Extra',selection_type:1,group:'extras',has_color:false}];
 const configuration={...config,parts:[{part_id:'10',color_id:'3',addons:[{addon_id:'1'},{addon_id:'3'}]},{part_id:'11',color_id:'3',addons:[{addon_id:'4'}]}]};
 let captured;
 const args={...input({}),configuration,part:length,partColorId:'3',choices,allParts:[length,type],quantity:6};
 args.client={withSignal:()=>({previewCustomPrices:async request=>{captured=request;return response(request)}})};
 const labels=await readOptionPriceDifferences(args);
 const full=captured.scenarios[2].configuration;
 assert.deepEqual(full.parts.find(p=>p.part_id==='10').addons.map(a=>a.addon_id),['3','2']);
 assert.deepEqual(full.parts.find(p=>p.part_id==='11').addons,[]);
 assert.deepEqual(captured.scenarios[3].configuration.parts.find(p=>p.part_id==='10').addons.map(a=>a.addon_id),['1']);
 assert.match(labels['3'],/^Remove:/);
 assert.deepEqual(configuration.parts[1].addons,[{addon_id:'4'}]);
});
test('price reconciliation detects component changes even when total is unchanged',()=>{
 const line={subtotal:'100',branding_total:'20',cgst:'0',sgst:'0',igst:'6',total:'126',variants:[{quantity:1,unit_price:'100'}]};
 const before={...line,lines:[line]},after=structuredClone(before);
 assert.equal(quotePriceChanges(before,after),null);
 after.lines[0].subtotal='90';after.lines[0].branding_total='30';
 assert.deepEqual(quotePriceChanges(before,after).lines[0].components,['subtotal','branding_total']);
});

test('real SDK exposes previews as cancellable reads through the existing RPC',async()=>{
 const {createSquadClient}=await import('./squad.js');const request={scenarios:[{configuration:config,quantity:6}]};
 let received,signal;
 const client=createSquadClient({schema(name){
  assert.equal(name,'canto_api');
  return {rpc(name,args){
   received={name,args};
   return {abortSignal(input){signal=input;return Promise.resolve({data:response(request),error:null});}};
  }};
 }});
 const controller=new AbortController();await readPricePreviews({client,request,signal:controller.signal,isCurrent:()=>true,customerId:'103',generation:'1'});
 assert.equal(received.name,'v1_configuration_quote');assert.deepEqual(received.args,{p_request:request});assert.equal(signal,controller.signal);
 controller.abort();await assert.rejects(client.withSignal(controller.signal).previewCustomPrices(request));
});

test('explicit sample mode remains fixed even when the planned volume is bulk',async()=>{
 const part={id:'1',name:'Collar'},choice={id:'2',name:'Extra',has_color:false,selection_type:1},configuration={...config,parts:[{part_id:'1',color_id:'3',addons:[]}]};let captured;
 const args={...input({}),configuration,part,partColorId:'3',choices:[choice],allParts:[part],quantity:100,sample:true};
 args.client={withSignal:()=>({previewCustomPrices:async request=>{captured=request;const r=response(request);for(const s of r.scenarios)s.prices=[{...price(100,'500'),sample_rate_applied:true}];return r;}})};
 const result=await readOptionPriceDifferences(args);assert.ok(captured.scenarios.every(s=>s.sample===true));assert.equal(result['2'],'No change at sample rate');
});
