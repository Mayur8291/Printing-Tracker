import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer";
import { ROLE_NAMES } from "../../apps/admin/src/squad/navigation/registry.js";
let input = ""; for await (const part of process.stdin) input += part;
const config = JSON.parse(input); input = "";
assert.equal(config.url, "https://scvojtvgnkmbupvyslmb.supabase.co");
const base = process.env.SQUAD_WEB_TEST_URL || "http://localhost:5183";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Explicit local test client required");
const browser = await puppeteer.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const actors = []; const violations = [];
fs.mkdirSync("docs/squad-one-web/evidence", { recursive: true });
try {
  for (const actor of config.actors) {
    const context = await browser.createBrowserContext(); const page = await context.newPage();
    const errors = []; const requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.hostname.endsWith("supabase.co") && url.hostname !== "scvojtvgnkmbupvyslmb.supabase.co" || /scott.*(?:api|international)|165\.22\.210\.53|64\.227\.186\.227/.test(url.hostname)) {
        violations.push({ role: actor.role, host: url.hostname }); void request.abort(); return;
      }
      if (url.pathname.startsWith("/rest/v1/")) requests.push(url.pathname);
      void request.continue();
    });
    try {
      await page.setViewport({ width: 1440, height: 1000 });
      await page.goto(`${base}/squad/home`, { waitUntil: "networkidle0" });
      await page.waitForSelector("#login-email");
      await page.type("#login-email", actor.email); await page.type("#login-password", actor.password);
      await page.click("button[type=submit]");
      await page.waitForSelector(".squad-app", { timeout: 40_000 });
      await page.waitForFunction((role) => document.querySelector(".squad-app")?.textContent.includes(role), { timeout: 20_000 }, ROLE_NAMES[actor.role]);
      if (actor.role !== 12) await page.waitForFunction(() => document.querySelector(".squad-metric strong")?.textContent !== "—" && document.querySelector(".squad-metric strong"), { timeout: 25_000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `docs/squad-one-web/evidence/role-${actor.role}-desktop.png` });
      if (actor.role !== 0) {
        await page.goto(`${base}/squad/administration`);
        await page.waitForFunction(() => document.querySelector(".squad-app")?.textContent.includes("Your role does not have access"), { timeout: 20_000 });
      }
      await page.goto(`${base}/squad/profile`);
      await page.waitForFunction(() => document.querySelector("h1")?.textContent === "My account", { timeout: 20_000 });
      assert.equal(await page.$eval("button[type=submit]", (element) => element.disabled), true, "Mirror profile write is disabled");
      await page.goto(`${base}/squad/notifications`);
      await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Notifications", { timeout: 20_000 });
      if (actor.role === 3) {
        await page.setViewport({ width: 390, height: 844 });
        await page.goto(`${base}/squad/home`);
        await page.waitForSelector(".squad-metric", { timeout: 25_000 });
        await page.screenshot({ path: "docs/squad-one-web/evidence/customer-mobile.png" });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      if ([3,12].includes(actor.role)) {
        const control = async action => { const response = await fetch(config.control_url, {method:'POST',headers:{Authorization:`Bearer ${config.control_token}`,'Content-Type':'application/json'},body:JSON.stringify({id:actor.id,action})}); assert.equal(response.status,200); };
        if (actor.role === 12) {
          await page.goto(`${base}/squad/tasks`); await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='Tasks & notes');
          await control('remove_features'); await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
          await page.waitForFunction(()=>document.querySelector('.squad-app')?.textContent.includes('Your role does not have access'),{timeout:20000});
          await control('restore'); await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
          await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='Tasks & notes',{timeout:20000});
        } else {
          await control('disable'); await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
          await page.waitForFunction(()=>document.body.textContent.includes('Your workspace is unavailable')&&!document.querySelector('.squad-app'),{timeout:20000});
          await control('restore'); await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
          await page.waitForSelector('.squad-app',{timeout:20000});
        }
      }
      // Exercise actual token rotation without exposing tokens or adding application test hooks.
      await page.evaluate(async () => {
        const { supabase } = await import('/src/supabaseClient.js');
        const before = (await supabase.auth.getSession()).data.session;
        const refreshed = await supabase.auth.refreshSession();
        if (refreshed.error || !refreshed.data.session || refreshed.data.user.id !== before.user.id) throw new Error('Session rotation failed');
      });
      await page.goto(`${base}/squad/profile`);
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'My account', { timeout: 20000 });
      await page.evaluate(async () => { const { supabase } = await import('/src/supabaseClient.js'); const result = await supabase.auth.signOut({ scope: 'local' }); if (result.error) throw result.error; });
      await page.waitForSelector('#login-email', { timeout: 20000 });
      await page.goto(`${base}/squad/orders`);
      await page.waitForSelector('#login-email', { timeout: 20000 });
      assert.equal(await page.$('.squad-app'), null, 'Protected pages and cached records must disappear after logout');
      assert.ok(!requests.some((path) => /\/profiles|\/sa_users/.test(path)), "Squad session must never hit staff or raw source tables");
      assert.deepEqual(errors, []);
      actors.push({ role: actor.role, real_password_login: true, token_refresh: true, live_account_revocation: actor.role===3, live_capability_revocation: actor.role===12, logout_clears_workspace: true, signed_out_deep_link_denied: true, correct_workspace: true, deep_links: true, forbidden_route: actor.role !== 0, mirror_write_disabled: true, tracker_table_requests: 0, browser_errors: 0 });
      console.error(`Persona ${actor.role} passed`);
    } finally { actor.password = ""; await context.close(); }
  }
  assert.deepEqual(violations, []);
  console.log(JSON.stringify({ actors, violations, scope: "Real-Auth persona entry, token rotation, logout, live account/capability revocation and dashboard reads; not complete business mutation acceptance", timestamp: new Date().toISOString() }));
} finally { await browser.close(); }
