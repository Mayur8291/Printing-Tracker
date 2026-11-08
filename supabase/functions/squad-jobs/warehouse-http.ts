import { object, WarehouseError } from "./warehouse-types.ts";
export interface WarehouseResponse {
  status: number;
  body: Record<string, any>;
  retryAfter?: number;
}
function retryDelay(value: string | null): number | undefined {
  if (!value || value.length > 128) return undefined;
  const header = value.trim();
  let seconds: number;
  if (/^\d+$/.test(header)) seconds = Number(header);
  else {
    // RFC 9110 HTTP-date forms only. Date.parse also accepts unrelated values
    // such as decimal numbers, which must not become provider cooldowns.
    if (
      !/^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/
        .test(header)
    ) return undefined;
    const date = Date.parse(header);
    if (!Number.isFinite(date)) return undefined;
    seconds = Math.ceil((date - Date.now()) / 1000);
  }
  // Match the existing SQL retry contract. Its exponential backoff can impose a
  // longer minimum; provider headers cannot create an unbounded queue delay.
  return Math.min(3600, Math.max(5, seconds));
}
async function abortable<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let stop: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
export function warehouseHttp(base: string, request: typeof fetch = fetch) {
  return async (
    path: string,
    init: RequestInit,
    signal: AbortSignal,
    maxBytes = 2 * 1024 * 1024,
  ): Promise<WarehouseResponse> => {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
      throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
    }
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
    let response: Response;
    try {
      bounded.throwIfAborted();
      response = await abortable(
        request(base + path, { ...init, redirect: "error", signal: bounded }),
        bounded,
      );
    } catch {
      throw new WarehouseError("RETRY", "PROVIDER_UNAVAILABLE");
    }
    const retryAfter = retryDelay(response.headers.get("retry-after"));
    if (
      response.status === 408 || response.status === 429 ||
      response.status >= 500
    ) {
      // Gateways commonly send text/HTML, an empty body, or a stalled stream.
      // The retry status/header is already authoritative; parsing that body
      // must not discard its cooldown or consume the provider deadline.
      void response.body?.cancel().catch(() => {});
      responseFailure({ status: response.status, body: {}, retryAfter });
    }
    const opaqueAuth = response.status === 401 || response.status === 403
      ? { status: response.status, body: {}, retryAfter }
      : undefined;
    if (!response.body) {
      if (opaqueAuth) return opaqueAuth;
      throw new WarehouseError("RETRY", "PROVIDER_RESPONSE_INVALID");
    }
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await abortable(reader.read(), bounded);
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          throw new WarehouseError(
            "RECONCILIATION_REQUIRED",
            "PROVIDER_RESPONSE_LIMIT",
          );
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof WarehouseError) throw error;
      throw new WarehouseError("RETRY", "PROVIDER_UNAVAILABLE");
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let body: Record<string, any>;
    try {
      body = object(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
    } catch {
      // Preserve status handling in the adapters: Uniware refreshes a rejected
      // read once, but must not replay an uncertain mutating request.
      if (opaqueAuth) return opaqueAuth;
      throw new WarehouseError("RETRY", "PROVIDER_RESPONSE_INVALID");
    }
    return {
      status: response.status,
      body,
      ...(retryAfter ? { retryAfter } : {}),
    };
  };
}
export function responseFailure(r: WarehouseResponse): never {
  if (r.status === 401 || r.status === 403) {
    throw new WarehouseError("RETRY", "PROVIDER_AUTH_UNAVAILABLE", 300);
  }
  if (r.status === 429 || r.status >= 500 || r.status === 408) {
    throw new WarehouseError(
      "RETRY",
      "PROVIDER_UNAVAILABLE",
      r.retryAfter ?? 60,
    );
  }
  throw new WarehouseError("REJECTED", "PROVIDER_REJECTED");
}
