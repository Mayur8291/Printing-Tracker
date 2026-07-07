export const TONE_DEFAULT_STATUS = "sounds/tone-01.mp3";
export const TONE_READY_STATUS = "sounds/Tone-02.mp3";
export const TONE_READY_OVERDUE = "sounds/Tone-03.mp3";

let userCustomToneUrl = null;
let muteStatusTones = false;

const toneAudioCache = new Map();
const tonePrimed = new Set();

function staticAssetUrl(relPath) {
  const base = import.meta.env.BASE_URL ?? "/";
  const b = base.endsWith("/") ? base : `${base}/`;
  return `${b}${relPath.replace(/^\//, "")}`;
}

function resolveBuiltinToneUrl(file) {
  try {
    return new URL(staticAssetUrl(file), window.location.href).href;
  } catch {
    return staticAssetUrl(file);
  }
}

function resolvePlaybackUrl(builtinFile) {
  return userCustomToneUrl || resolveBuiltinToneUrl(builtinFile);
}

export function setMuteStatusTones(muted) {
  muteStatusTones = Boolean(muted);
}

export function setUserNotificationToneUrl(url) {
  userCustomToneUrl = url?.trim() || null;
  toneAudioCache.clear();
  tonePrimed.clear();
}

export function getUserNotificationToneUrl() {
  return userCustomToneUrl;
}

function getToneAudio(url) {
  if (!toneAudioCache.has(url)) {
    const el = new Audio(url);
    el.preload = "auto";
    toneAudioCache.set(url, el);
  }
  return toneAudioCache.get(url);
}

function playUrl(url) {
  if (!url || muteStatusTones) return;
  try {
    const tryPlay = (el) => {
      if (!el) return Promise.reject(new Error("no audio"));
      el.volume = 1;
      el.pause();
      el.currentTime = 0;
      return el.play();
    };

    const cached = getToneAudio(url);
    const p = tryPlay(cached);
    if (p) {
      void p.catch(() => {
        try {
          const fresh = new Audio(url);
          fresh.preload = "auto";
          fresh.volume = 1;
          void fresh.play().catch(() => {});
        } catch {
          /* ignore */
        }
      });
    }
  } catch {
    try {
      const fresh = new Audio(url);
      fresh.volume = 1;
      void fresh.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

export function playNotificationTone(builtinFile = TONE_DEFAULT_STATUS) {
  if (muteStatusTones) return;
  playUrl(resolvePlaybackUrl(builtinFile));
}

/** Tone-02 only when status becomes Ready to Dispatch; Tone-01 for other status changes (unless custom tone set). */
export function playOrderStatusChangeTone(isReadyToDispatch) {
  if (muteStatusTones) return;
  playNotificationTone(isReadyToDispatch ? TONE_READY_STATUS : TONE_DEFAULT_STATUS);
}

export function playReadyDispatchOverdueTone() {
  if (muteStatusTones) return;
  playNotificationTone(TONE_READY_OVERDUE);
}

/** Preview a specific URL (upload preview or default builtin). Respects mute flag. */
export function previewNotificationToneUrl(url) {
  if (!url || muteStatusTones) return;
  playUrl(url);
}

/** Call once after a user gesture so autoplay policy allows tones later. */
export function primeNotificationTonesFromUserGesture() {
  const urls = userCustomToneUrl
    ? [userCustomToneUrl]
    : [TONE_DEFAULT_STATUS, TONE_READY_STATUS, TONE_READY_OVERDUE].map(resolveBuiltinToneUrl);

  for (const url of urls) {
    if (tonePrimed.has(url)) continue;
    try {
      const el = getToneAudio(url);
      el.volume = 0.001;
      void el
        .play()
        .then(() => {
          el.pause();
          el.currentTime = 0;
          el.volume = 1;
          tonePrimed.add(url);
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

export function resolveDefaultNotificationToneUrl() {
  return resolveBuiltinToneUrl(TONE_DEFAULT_STATUS);
}
