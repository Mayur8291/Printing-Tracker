/** Shared RPC transport for mobile and web. It never exposes a table interface. */
export class SquadError extends Error {
  constructor(error) {
    super(error.message || "The request could not be completed.");
    this.name = "SquadError";
    this.code = error.code || "TRANSPORT_ERROR";
    this.kind = ({"28000":"session", "42501":"forbidden", "40001":"conflict",
      "22023":"validation", "22P02":"validation", "22007":"validation", "23P01":"validation", "P0002":"not_found", "55000":"unavailable"})[this.code] || "unexpected";
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
    dashboard: (filters = {}) => call("v1_dashboard", { p_filters: filters }),
    catalogue: (kind = "products", filters = {}, page = {}) => call("v1_catalog_tree", {
      p_kind:kind,p_filters:filters,p_cursor:page.cursor??null,p_limit:page.limit??30
    }),
    baseProduct: (id) => call("v1_base_product_get", {p_id:id}),
    catalogueOptions: (kind = "brands", customerId = null, page = {}) => call("v1_catalog_options", {
      p_kind:kind,p_customer_id:customerId,p_cursor:page.cursor??null,p_limit:page.limit??30
    }),
    readyMade: (filters = {}, customerId = null, page = {}) => call("v1_rmp_search", {
      p_filters:filters,p_customer_id:customerId,p_cursor:page.cursor??null,p_limit:page.limit??30
    }),
    readyMadeDetail: (id,customerId = null) => call("v1_rmp_detail", {p_id:id,p_customer_id:customerId}),
    readyMadeVariants: (classId,customerId = null,filters = {},page = {}) => call("v1_rmp_variants", {
      p_class_id:classId,p_customer_id:customerId,p_filters:filters,p_cursor:page.cursor??null,p_limit:page.limit??30
    }),
    configuratorOptions: (baseId,kind,selection = {},page = {}) => call("v1_configurator_options", {
      p_base_id:baseId,p_kind:kind,p_parent_id:selection.parentId??null,p_part_id:selection.partId??null,
      p_cursor:page.cursor??null,p_limit:page.limit??30
    }),
    validateQuantities: (quantities,sample = null) => call("v1_item_quantity_validate", {p_quantities:quantities,p_sample:sample}),
    quote: (request) => call("v1_quote", {p_request:request}),
    catalogueQuote: (request,markup = {kind:"percentage",value:"0"}) => call("v1_catalogue_quote", {p_request:request,p_markup:markup}),
    tasks: (filters = {}, page = {}) => call("v1_tasks_list", {
      p_state: filters.state ?? null, p_order_id: filters.orderId ?? null,
      p_cursor: page.cursor ?? null, p_limit: page.limit ?? 30
    }),
    task: (id) => call("v1_task_get", {p_id:id}),
    taskAssignees: (page = {}) => call("v1_task_assignees", {p_cursor:page.cursor??null,p_limit:page.limit??30}),
    saveTask: (task, command) => call("v1_task_save", {
      p_id:task.id??null,p_note:task.note,p_deadline:task.deadline,p_order_id:task.orderId??null,
      p_assignee_ids:task.assigneeIds,p_expected_version:command.expectedVersion??null,p_idempotency_key:command.idempotencyKey
    }),
    transitionTask: (id,state,command) => call("v1_task_transition", {
      p_id:id,p_state:state,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    responsibilities: (filters = {},page = {}) => call("v1_responsibilities_list", {
      p_subject_id:filters.subjectId??null,p_kind:filters.kind??null,p_completed:filters.completed??null,
      p_cursor:page.cursor??null,p_limit:page.limit??30
    }),
    saveResponsibilities: (items,idempotencyKey) => call("v1_responsibility_save", {p_items:items,p_idempotency_key:idempotencyKey}),
    transitionResponsibility: (id,state,reason,command) => call("v1_responsibility_transition", {
      p_id:id,p_state:state,p_reason:reason??null,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    milestones: (subjectId,page = {}) => call("v1_milestones_list", {p_subject_id:subjectId??null,p_cursor:page.cursor??null,p_limit:page.limit??30}),
    milestoneProgress: (id) => call("v1_milestone_progress", {p_id:id}),
    saveMilestone: (target,command) => call("v1_milestone_save", {
      p_id:target.id??null,p_subject_id:target.subjectId,p_start:target.start,p_end:target.end,
      p_amount:target.amount,p_name:target.name,p_expected_version:command.expectedVersion??null,p_idempotency_key:command.idempotencyKey
    }),
    archiveMilestone: (id,reason,command) => call("v1_milestone_archive", {
      p_id:id,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    })
  });
}
