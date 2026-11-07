import { normalizeChatMime } from "./teamChatUtils";

export const VOICE_NOTE_MAX_MS = 5 * 60 * 1000;
const MIN_VOICE_BYTES = 200;

export function pickVoiceRecorderMime() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? "";
}

export function voiceNoteExtension(mime) {
  const normalized = normalizeChatMime(mime);
  if (normalized === "audio/mp4" || normalized === "audio/x-m4a" || normalized === "audio/aac") {
    return "m4a";
  }
  if (normalized === "audio/ogg") return "ogg";
  if (normalized === "audio/mpeg") return "mp3";
  if (normalized === "audio/wav" || normalized === "audio/x-wav") return "wav";
  return "webm";
}

export async function startChatVoiceRecording() {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Voice notes not supported in this browser");
  }

  const mime = pickVoiceRecorderMime();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = mime
    ? new MediaRecorder(stream, { mimeType: mime })
    : new MediaRecorder(stream);
  const chunks = [];

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  });
  recorder.start(250);

  return { recorder, stream, chunks, mime: recorder.mimeType || mime };
}

export function stopChatVoiceRecording(session) {
  return new Promise((resolve) => {
    const recorder = session?.recorder;
    const stream = session?.stream;
    const stopTracks = () => {
      stream?.getTracks?.().forEach((track) => track.stop());
    };

    if (!recorder || recorder.state === "inactive") {
      stopTracks();
      resolve();
      return;
    }

    recorder.addEventListener(
      "stop",
      () => {
        stopTracks();
        resolve();
      },
      { once: true }
    );
    recorder.stop();
  });
}

export function buildVoiceNoteFile(session) {
  const chunks = session?.chunks ?? [];
  if (!chunks.length) return null;

  const mime = normalizeChatMime(session?.recorder?.mimeType || session?.mime) || "audio/webm";
  const blob = new Blob(chunks, { type: mime });
  if (blob.size < MIN_VOICE_BYTES) return null;

  return new File([blob], `Voice note.${voiceNoteExtension(mime)}`, { type: mime });
}
