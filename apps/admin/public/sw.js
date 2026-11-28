/* Service worker for Scott One (/squad) and the dashboard.
   Business data, sign-in and API traffic are never cached: only the app's own static files are.
   Dashboard page loads are left to the browser, so a new deploy still replaces the order list. */
const VERSION = "__BUILD_ID__";
const SHELL = `sc1-shell-${VERSION}`;
const ASSETS = "sc1-assets";
const MAX_ASSETS = 150;
const PRECACHE = ["/squad.html", "/offline.html", "/pwa/icon-192.png", "/pwa/apple-touch-icon.png"];
const isStatic = (path) => /^\/(assets|pwa|squad-icons)\//.test(path) || path === "/brand-logo.png";

self.addEventListener("install", (event) => {
  // No skipWaiting: the page asks the person before switching to a new version.
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== SHELL && key !== ASSETS).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function store(request, response) {
  if (!response.ok || response.type !== "basic" || response.headers.get("content-type")?.includes("text/html")) return;
  const cache = await caches.open(ASSETS);
  await cache.put(request, response);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((key) => cache.delete(key)));
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  // Files loaded before this worker took control, so the next launch can start offline.
  if (event.data?.type === "CACHE_ASSETS" && Array.isArray(event.data.urls)) {
    event.waitUntil(Promise.all(event.data.urls.slice(0, MAX_ASSETS).map(async (value) => {
      const url = new URL(value, self.location.origin);
      if (url.origin !== self.location.origin || !isStatic(url.pathname) || await caches.match(url.pathname)) return;
      try { await store(url.pathname, await fetch(url.pathname)); } catch { /* Fetched again when next needed. */ }
    })));
  }
});

async function squadPage(request) {
  const cache = await caches.open(SHELL);
  const saved = await cache.match("/squad.html");
  const controller = new AbortController();
  // Only give up on a slow network when there is a saved copy to show instead.
  const timer = saved ? setTimeout(() => controller.abort(), 4000) : null;
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.ok && response.headers.get("content-type")?.includes("text/html")) await cache.put("/squad.html", response.clone());
    return response;
  } catch {
    return saved || (await cache.match("/offline.html")) || Response.error();
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    if (url.pathname === "/squad" || url.pathname.startsWith("/squad/")) event.respondWith(squadPage(request));
    return;
  }
  if (!isStatic(url.pathname)) return;
  // Script requests carry an Origin header the saved copy lacks; these files are hashed, so ignore Vary.
  event.respondWith(caches.match(request, { ignoreVary: true }).then((hit) => hit || fetch(request).then((response) => {
    event.waitUntil(store(request, response.clone()));
    return response;
  })));
});
