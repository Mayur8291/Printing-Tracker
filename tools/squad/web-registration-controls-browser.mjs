// Actual registration controls with an explicit local transport fixture.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:5183';
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
const React=await import('/node_modules/.vite/deps/react.js'),ReactDOM=await import('/node_modules/.vite/deps/react-dom_client.js');await import('/src/styles.css');await import('/src/index.css');const{default:AccountFlow}=await import('/src/application/AccountFlow.jsx');
window.__calls=[];const sdk={requestRegistration:async(email,profile,key)=>{window.__calls.push({email,profile,key});return{accepted:true};}};
ReactDOM.default.createRoot(document.getElementById('root')).render(React.default.createElement(AccountFlow,{sdk,kind:'register',onBack:()=>{}}));
</script></body></html>`;

const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:390,height:844});await page.setRequestInterception(true);page.on('request',r=>r.url().includes('/__registration-controls')?r.respond({status:200,contentType:'text/html',body:html}):r.continue());await page.goto(base+'/__registration-controls');await page.waitForSelector('#account-email');
 const fill=async(key,value)=>page.$eval('#account-'+key,(n,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}));},value);
 for(const [key,value]of Object.entries({email:'single@example.invalid',first_name:'Single',company_name:'Synthetic company',phone:'123456789',address:'Synthetic address',zip_code:'123456',gst_no:'TEST-GST-ONLY'}))await fill(key,value);
 const state=await page.$eval('#account-state',n=>document.getElementById(n.list.id).options[0].value);await fill('state',state);await page.waitForFunction(()=>document.querySelector('#account-city')?.list.options.length>0);const city=await page.$eval('#account-city',n=>n.list.options[0].value);await fill('city',city);
 assert.equal(await page.$eval('#account-last_name',n=>n.required),false);assert.equal(await page.$eval('#account-gst_no',n=>n.required),false);assert.equal(await page.$eval('#account-phone',n=>n.checkValidity()),false);await page.click('button[type=submit]');assert.equal(await page.evaluate(()=>window.__calls.length),0);
 await fill('phone','1234567890');await page.click('button[type=submit]');await page.waitForSelector('#account-code');const call=await page.evaluate(()=>window.__calls[0]);assert.equal(call.profile.last_name,'');assert.equal(call.profile.gst_no,'TEST-GST-ONLY');assert.equal(call.profile.phone,'1234567890');assert.deepEqual(call.profile.addresses,[{address:'Synthetic address',state,city,zip_code:'123456'}]);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 console.log(JSON.stringify({passed:true,checks:['optional_last_name','optional_GST_preserved','ten_digit_phone_before_API','canonical_location_payload','mobile_no_overflow'],errors}));
}finally{await browser.close();}
