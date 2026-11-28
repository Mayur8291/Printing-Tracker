// Installability, updates and connection state for the Scott One web app.
const listeners = new Set();
let state = { updateReady: false, canInstall: false, online: typeof navigator === "undefined" ? true : navigator.onLine !== false };
let installEvent = null, registration = null, reloadRequested = false;

const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); };
export const subscribePwa = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const pwaSnapshot = () => state;

export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
/** iPhone and iPad have no install event; people use Share → Add to Home Screen. */
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 && !/android/i.test(navigator.userAgent));

export async function promptInstall() {
  if (!installEvent) return false;
  const event = installEvent;
  installEvent = null;
  set({ canInstall: false });
  await event.prompt();
  return (await event.userChoice)?.outcome === "accepted";
}

export function applyUpdate() {
  if (!registration?.waiting) return window.location.reload();
  reloadRequested = true;
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
}

const cacheLoadedFiles = (worker) => worker?.postMessage({ type: "CACHE_ASSETS", urls: performance.getEntriesByType("resource").map((entry) => entry.name) });

function watch(next) {
  registration = next;
  const ready = () => { if (next.waiting && navigator.serviceWorker.controller) set({ updateReady: true }); };
  ready();
  next.addEventListener("updatefound", () => {
    const worker = next.installing;
    worker?.addEventListener("statechange", () => { if (worker.state === "installed") ready(); });
  });
  const check = () => { if (document.visibilityState === "visible" && navigator.onLine) next.update().catch(() => {}); };
  document.addEventListener("visibilitychange", check);
  setInterval(check, 30 * 60 * 1000);
}

export function registerPwa() {
  window.addEventListener("online", () => set({ online: true }));
  window.addEventListener("offline", () => set({ online: false }));
  window.addEventListener("beforeinstallprompt", (event) => {
    // The dashboard keeps the browser's own install behaviour.
    if (!window.location.pathname.startsWith("/squad")) return;
    event.preventDefault();
    installEvent = event;
    set({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => { installEvent = null; set({ canInstall: false }); });
  if (!("serviceWorker" in navigator)) return;

  const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  // `?sw=1` allows testing the worker against a local production build.
  if (new URLSearchParams(window.location.search).has("sw")) sessionStorage.setItem("sc1.sw", "1");
  if (local && sessionStorage.getItem("sc1.sw") !== "1") {
    void navigator.serviceWorker.getRegistrations().then((all) => all.forEach((item) => void item.unregister()));
    return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloadRequested) { reloadRequested = false; window.location.reload(); } });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((next) => {
      watch(next);
      return navigator.serviceWorker.ready;
    }).then((next) => {
      cacheLoadedFiles(next?.active);
      // Screens loaded later in this visit are saved too.
      setTimeout(() => cacheLoadedFiles(next?.active), 15000);
    }).catch(() => {});
  });
}
