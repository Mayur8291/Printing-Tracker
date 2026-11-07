import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildVoiceNoteFile,
  startChatVoiceRecording,
  stopChatVoiceRecording,
  VOICE_NOTE_MAX_MS
} from "@/teamChatVoice";

export function ChatVoiceControls({
  disabled = false,
  onRecordingChange,
  onVoiceReady,
  onError
}) {
  const [recording, setRecording] = useState(false);
  const sessionRef = useRef(null);
  const timerRef = useRef(null);

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  async function finishRecording() {
    const session = sessionRef.current;
    sessionRef.current = null;
    clearTimer();
    setRecording(false);
    onRecordingChange?.(false);
    if (!session) return;

    try {
      await stopChatVoiceRecording(session);
      const file = buildVoiceNoteFile(session);
      if (!file) {
        onError?.("Recording too short");
        return;
      }
      onVoiceReady?.(file);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  async function startRecording() {
    if (disabled || recording) return;
    onError?.("");
    try {
      const session = await startChatVoiceRecording();
      sessionRef.current = session;
      setRecording(true);
      onRecordingChange?.(true);
      timerRef.current = setTimeout(() => {
        void finishRecording();
      }, VOICE_NOTE_MAX_MS);
    } catch (err) {
      const name = err?.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        onError?.("Allow microphone to record a voice note");
        return;
      }
      onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    return () => {
      clearTimer();
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) {
        void stopChatVoiceRecording(session);
      }
    };
  }, []);

  if (recording) {
    return (
      <Button
        type="button"
        variant="destructive"
        size="icon"
        className="size-9"
        aria-label="Stop recording"
        onClick={() => void finishRecording()}
      >
        <Square />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-9"
      aria-label="Record voice note"
      disabled={disabled}
      onClick={() => void startRecording()}
    >
      <Mic />
    </Button>
  );
}
