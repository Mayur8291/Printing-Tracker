export function isSchemaCacheError(message) {
  return String(message ?? "").toLowerCase().includes("schema cache");
}

export function isMissingPostgrestTableError(message) {
  const text = String(message ?? "");
  return text.includes("Could not find the table") && !isSchemaCacheError(text);
}

export function schemaCacheRetryDelayMs(attempt) {
  return 1500 * (attempt + 1);
}

export async function waitForSchemaCacheRetry(attempt) {
  await new Promise((resolve) => setTimeout(resolve, schemaCacheRetryDelayMs(attempt)));
}
