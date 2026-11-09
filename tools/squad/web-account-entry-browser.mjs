// Local rendered validation only. The SDK is an explicit fixture; no email or hosted Auth request is sent.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base = process.env.SQUAD_WEB_TEST_URL || 'http://localhost:5183';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
const React=await import('/node_modules/.vite/deps/react.js'),ReactDOM=await import('/node_modules/.vite/deps/react-dom_client.js');await import('/src/styles.css');await import('/src/index.css');const{default:AccountFlow}=await import('/src/application/AccountFlow.jsx');
window.__calls=[];window.__reject=true;const sdk={acceptInvitation:async value=>{window.__calls.push({length:value.password.length,bytes:new TextEncoder().encode(value.password).byteLength});if(window.__reject)throw Object.assign(new Error('Request failed'),{code:'INVALID_OR_EXPIRED_CODE'});return {completed:true,next:'sign_in'};}};
ReactDOM.default.createRoot(document.getElementById('root')).render(React.default.createElement(AccountFlow,{sdk,kind:'invite',onBack:()=>{}}));
</script></body></html>`;
const browser = await puppeteer.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const page = await browser.newPage(), errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request=>request.url().includes('/__account-policy')?request.respond({status:200,contentType:'text/html',body:html}):request.continue());
  await page.setViewport({width:390,height:844});
  await page.goto(base+'/__account-policy?request_id=11111111-1111-4111-8111-111111111111');
  await page.waitForSelector('#account-email');
  const fill = async (key,value)=>page.$eval('#account-'+key,(node,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);
  const submit = async ()=>page.click('button[type=submit]');
  const expectAlert = async text=>page.waitForFunction(text=>document.querySelector('[role=alert]')?.textContent.includes(text),{},text);
  await fill('email','local-fixture@example.invalid'); await fill('code','12345678');
  assert.equal(await page.$eval('#account-password',node=>node.minLength),12);
  assert.equal(await page.$eval('#account-password',node=>document.getElementById(node.getAttribute('aria-describedby')).textContent.includes('72 bytes')),true);
  for (const [password,message] of [['a'.repeat(11),'at least 12'],['é'.repeat(37),'too long']]) {
    await fill('password',password);await fill('confirm',password);await submit();await expectAlert(message);
    assert.equal(await page.evaluate(()=>window.__calls.length),0,'Invalid passwords must not reach the SDK');
  }
  await fill('password','a'.repeat(12));await fill('confirm','a'.repeat(12));await submit();await expectAlert('incorrect or has expired');
  assert.equal(await page.$eval('#account-code',node=>node.value),'12345678','Rejected proof retains the form for correction');
  await page.screenshot({path:'/tmp/squad-account-policy-mobile.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>{window.__reject=false;});
  await fill('password','é'.repeat(36));await fill('confirm','é'.repeat(36));await submit();
  await page.waitForSelector('[role=status]');
  assert.equal(await page.$('#account-password'),null);
  assert.deepEqual(await page.evaluate(()=>window.__calls),[{length:12,bytes:12},{length:36,bytes:72}]);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['11_characters_rejected_locally','74_utf8_bytes_rejected_locally','12_characters_accepted','72_utf8_bytes_accepted','expired_code_friendly_and_form_preserved','passwords_removed_after_success','mobile_no_overflow'],errors}));
} finally { await browser.close(); }
