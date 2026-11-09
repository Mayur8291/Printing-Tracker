import { createContext, useContext, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const SquadContext = createContext(null);
export function useSquad() {
  const value = useContext(SquadContext);
  if (!value) throw new Error("Squad session provider is required.");
  return value;
}

export function useSquadQuery(key, loader, options = {}) {
  const { scope, sdk, onAuthorizationError } = useSquad();
  return useQuery({
    queryKey: ["squad", scope, ...(Array.isArray(key) ? key : [key])],
    queryFn: async ({signal}) => {
      try { return await loader({signal,sdk:sdk?.withSignal?sdk.withSignal(signal):sdk}); }
      catch (error) {
        if(signal.aborted)throw error;
        if (["session", "forbidden"].includes(error.kind)) onAuthorizationError?.(error);
        throw error;
      }
    },
    staleTime: 15_000,
    gcTime: 120_000,
    retry: false,
    ...options,
  });
}

/** Identical uncertain retries retain their command key; edited intent gets a new one. */
export function useSquadCommand() {
  const client = useQueryClient();
  const { scope, canWrite, writeState, onAuthorizationError } = useSquad();
  const intent = useRef(null);
  const inFlight = useRef(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  async function run(execute, options = {}) {
    if (inFlight.current) return inFlight.current;
    if ((!canWrite || (writeState?.mode === "test" && !(Date.parse(writeState.expires_at) > Date.now()))) && options.allowReadOnly !== true) {
      const denied = new Error("This environment is read-only. Changes require an authorized testing session or native ownership.");
      denied.kind = "unavailable";
      setError(denied);
      throw denied;
    }
    const fingerprint = JSON.stringify([scope, options.key || "command", options.payload ?? {}, options.expectedVersion ?? null]);
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, idempotencyKey: crypto.randomUUID() };
    const command = { idempotencyKey: intent.current.idempotencyKey, expectedVersion: options.expectedVersion ?? null };
    setPending(true); setError(null);
    const operation = Promise.resolve().then(async () => {
      try {
        const result = await execute(command);
        intent.current = null;
        await client.invalidateQueries({ queryKey: ["squad", scope] });
        return result;
      } catch (cause) {
        setError(cause);
        if (["session", "forbidden"].includes(cause.kind)) onAuthorizationError?.(cause);
        throw cause;
      } finally { setPending(false); inFlight.current = null; }
    });
    inFlight.current = operation;
    return operation;
  }
  return { run, pending, error, reset() { if (!inFlight.current) { intent.current = null; setError(null); } } };
}

export function useCursorPage(resetKey) {
  const [state, setState] = useState({ key: resetKey, cursors: [null] });
  const cursors = state.key === resetKey ? state.cursors : [null];
  return {
    cursor: cursors.at(-1), page: cursors.length,
    next(cursor) { if (cursor) setState({ key: resetKey, cursors: [...cursors, cursor] }); },
    previous() { setState({ key: resetKey, cursors: cursors.slice(0, -1).length ? cursors.slice(0, -1) : [null] }); },
    reset() { setState({ key: resetKey, cursors: [null] }); },
  };
}
