/** Shared RPC transport for mobile and web. It never exposes a table interface. */
export class SquadError extends Error {
  constructor(error) {
    super(error.message || "The request could not be completed.");
    this.name = "SquadError";
    this.code = error.code || "TRANSPORT_ERROR";
    this.kind = ({"28000":"session", "42501":"forbidden", "40001":"conflict",
      "22023":"validation", "55000":"unavailable"})[this.code] || "unexpected";
  }
}

/** Keep a command's key and payload unchanged when retrying an uncertain response. */
export function createSquadClient(supabase) {
  const api = supabase.schema("canto_api");
  async function call(name, args = {}) {
    const { data, error } = await api.rpc(name, args);
    if (error) throw new SquadError(error);
    return data;
  }
  return Object.freeze({
    me: () => call("v1_me"),
    saveProfile: (fields, command) => call("v1_profile_save", {
      p_fields: fields, p_expected_version: command.expectedVersion,
      p_idempotency_key: command.idempotencyKey
    })
  });
}
