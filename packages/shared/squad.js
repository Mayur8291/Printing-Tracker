/** Shared RPC transport for mobile and web. It never exposes a table interface. */
export class SquadError extends Error {
  constructor(error) {
    super(error.message || "The request could not be completed.");
    this.name = "SquadError";
    this.code = error.code || "TRANSPORT_ERROR";
    this.kind = ({"28000":"session", "42501":"forbidden", "40001":"conflict",
      "22023":"validation", "22P02":"validation", "22007":"validation", "P0002":"not_found", "55000":"unavailable"})[this.code] || "unexpected";
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
    }),
    people: (filters = {}, page = {}) => call("v1_people_list", {
      p_role: filters.role ?? null, p_search: filters.search ?? "",
      p_cursor: page.cursor ?? null, p_limit: page.limit ?? 30
    }),
    person: (id) => call("v1_person_get", { p_id: id }),
    orders: (filters = {}, page = {}) => call("v1_orders_list", {
      p_filters: filters, p_cursor: page.cursor ?? null, p_limit: page.limit ?? 30
    }),
    order: (id, items = {}) => call("v1_order_get", {
      p_id: id, p_item_cursor: items.cursor ?? null, p_item_limit: items.limit ?? 50
    }),
    dashboard: (filters = {}) => call("v1_dashboard", { p_filters: filters })
  });
}
