import puppeteer from 'puppeteer';
import fs from 'node:fs';
const fixture=JSON.parse(fs.readFileSync('tools/canto-sync/private/admin-test.json'));
if(fixture.url!=='https://scvojtvgnkmbupvyslmb.supabase.co')throw Error('Staging fixture required');
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('canto:admin-target:v1',JSON.stringify({source:'supabase',environment:'staging'}));localStorage.setItem('scott-dashboard-env-override','staging');});
 await page.goto('http://127.0.0.1:5173');await page.waitForSelector('#login-email');
 await page.type('#login-email',fixture.email);await page.type('#login-password',fixture.password);await page.click('button[type=submit]');
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.innerText==='Masters'),{timeout:60000});
 const state=await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}}));
 fs.writeFileSync('tools/canto-sync/private/browser-state.json',JSON.stringify(state),{mode:0o600});
 console.log('Real staging administrator sign-in passed. Session retained privately for acceptance.');
}finally{await browser.close();}
