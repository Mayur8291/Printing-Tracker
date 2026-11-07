/** Shared RPC transport for mobile and web. It never exposes a table interface. */
export class SquadError extends Error {
  constructor(error) {
    super(error.message || "The request could not be completed.");
    this.name = "SquadError";
    this.code = error.code || "TRANSPORT_ERROR";
    this.kind = ({"28000":"session", "42501":"forbidden", "40001":"conflict",
      "22023":"validation", "22P02":"validation", "22007":"validation", "23P01":"validation", "23505":"conflict", "54000":"validation", "P0002":"not_found", "55000":"unavailable"})[this.code] || "unexpected";
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
    bootstrap: (platform,version = null) => call("v1_app_bootstrap", {p_platform:platform,p_version:version}),
    saveCapabilities: (id,features,reason,command) => call("v1_person_capabilities_save", {p_id:id,p_features:features,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey}),
    promotions: (filters = {},page = {}) => call("v1_promotions_list", {p_filters:filters,p_cursor:page.cursor??null,p_limit:page.limit??30}),
    banners: (page = {}) => call("v1_banners_list", {p_cursor:page.cursor??null,p_limit:page.limit??30}),
    settings: (group,page = {}) => call("v1_settings_read", {p_group:group,p_cursor:page.cursor??null,p_limit:page.limit??30}),
    saveSettings: (group,id,fields,reason,command) => call("v1_settings_save", {p_group:group,p_id:id,p_fields:fields,p_reason:reason,p_expected_version:command.expectedVersion??null,p_idempotency_key:command.idempotencyKey}),
    saveProfile: (fields, command) => call("v1_profile_save", {
      p_fields: fields, p_expected_version: command.expectedVersion,
      p_idempotency_key: command.idempotencyKey
    }),
    people: (filters = {}, page = {}) => call("v1_people_list", {
      p_role: filters.role ?? null, p_search: filters.search ?? "",
      p_cursor: page.cursor ?? null, p_limit: page.limit ?? 30,
      p_filters:Object.fromEntries(Object.entries(filters).filter(([key])=>key!=="role"&&key!=="search"))
    }),
    person: (id) => call("v1_person_get", { p_id: id }),
    savePerson: (id,role,fields,command) => call("v1_person_save", {p_id:id,p_role:role,p_fields:fields,p_expected_version:command.expectedVersion??null,p_idempotency_key:command.idempotencyKey}),
    saveFactoryTeam: (id,role,fields,command) => call("v1_factory_team_save", {p_id:id,p_role:role,p_fields:fields,p_expected_version:command.expectedVersion??null,p_idempotency_key:command.idempotencyKey}),
    saveTailor: (id,fields,command) => call("v1_tailor_save", {p_id:id,p_fields:fields,p_expected_version:command.expectedVersion??null,p_idempotency_key:command.idempotencyKey}),
    saveSubtailor: (id,fields,command) => call("v1_subtailor_save", {p_id:id,p_fields:fields,p_expected_version:command.expectedVersion??null,p_idempotency_key:command.idempotencyKey}),
    archivePerson: (id,reason,command) => call("v1_person_archive", {p_id:id,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey}),
    factories: (search = "",page = {}) => call("v1_factories_list", {p_search:search,p_cursor:page.cursor??null,p_limit:page.limit??30}),
    saveFactory: (id,name,command) => call("v1_factory_save", {p_id:id,p_name:name,p_expected_version:command.expectedVersion??null,p_idempotency_key:command.idempotencyKey}),
    saveAddress: (id,userId,fields,command) => call("v1_address_save", {p_id:id,p_user_id:userId,p_fields:fields,p_expected_version:command.expectedVersion??null,p_idempotency_key:command.idempotencyKey}),
    archiveAddress: (id,userId,command) => call("v1_address_archive", {p_id:id,p_user_id:userId,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey}),
    reviewCustomer: (id,fields,reason,command) => call("v1_customer_review", {p_id:id,p_fields:fields,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey}),
    saveCustomerLinks: (id,links,reason,command) => call("v1_customer_links_save", {p_id:id,p_coordinator_id:links.coordinatorId,p_dealer_ids:links.dealerIds,p_direct:links.direct,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey}),
    saveDealerRules: (id,fields,reason,command) => call("v1_dealer_rules_save", {p_id:id,p_fields:fields,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey}),
    saveCommercialRules: (id,fields,reason,command) => call("v1_customer_commercial_rules_save", {p_id:id,p_fields:fields,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey}),
    reassignCustomers: (customers,coordinatorId,reason,idempotencyKey) => call("v1_customers_reassign", {p_customers:customers,p_coordinator_id:coordinatorId,p_reason:reason,p_idempotency_key:idempotencyKey}),
    requestCoordinator: (coordinatorId,reason,idempotencyKey) => call("v1_coordinator_change_request", {p_coordinator_id:coordinatorId,p_reason:reason,p_idempotency_key:idempotencyKey}),
    coordinatorRequests: (filters = {},page = {}) => call("v1_coordinator_requests", {p_state:filters.state??"pending",p_customer_id:filters.customerId??null,p_cursor:page.cursor??null,p_limit:page.limit??30}),
    decideCoordinatorRequest: (id,decision,reason,customerVersion,command) => call("v1_coordinator_change_decide", {p_id:id,p_decision:decision,p_reason:reason,p_customer_expected_version:customerVersion,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey}),
    relationshipOptions: (kind,context = {},page = {}) => call("v1_relationship_options", {p_kind:kind,p_customer_id:context.customerId??null,p_search:context.search??"",p_cursor:page.cursor??null,p_limit:page.limit??30}),
    orders: (filters = {}, page = {}) => call("v1_orders_list", {
      p_filters: filters, p_cursor: page.cursor ?? null, p_limit: page.limit ?? 30
    }),
    order: (id, items = {}) => call("v1_order_get", {
      p_id: id, p_item_cursor: items.cursor ?? null, p_item_limit: items.limit ?? 50
    }),
    ratings: (kind,id,filters = {},page = {}) => call("v1_ratings_list", {p_entity_kind:kind,p_entity_id:id,p_from_id:filters.fromId??null,p_to_id:filters.toId??null,p_include_archived:filters.includeArchived??false,p_cursor:page.cursor??null,p_limit:page.limit??30}),
    saveRating: (id,kind,entityId,toId,fields,command) => call("v1_rating_save", {p_id:id,p_entity_kind:kind,p_entity_id:entityId,p_to_id:toId,p_fields:fields,p_expected_version:command.expectedVersion??null,p_idempotency_key:command.idempotencyKey}),
    archiveRating: (id,reason,command) => call("v1_rating_archive", {p_id:id,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey}),
    dashboard: (filters = {}) => call("v1_dashboard", { p_filters: filters }),
    dealerStock: (filters = {}, context = {}, page = {}) => call("v1_dealer_stock", {
      p_dealer_id:context.dealerId??null,p_customer_id:context.customerId??null,
      p_filters:filters,p_cursor:page.cursor??null,p_limit:page.limit??30
    }),
    previewBackorder: (orderIds,addressId) => call("v1_backorder_preview", {p_order_ids:orderIds,p_address_id:addressId}),
    placeBackorder: (previewId,dueAt,command) => call("v1_backorder_place", {
      p_preview_id:previewId,p_due_at:dueAt,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    saveDispatchDestination: (id,destination,reason,command) => call("v1_dispatch_destination_save", {
      p_id:id,p_destination:destination,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    deliveries: (filters = {},page = {}) => call("v1_deliveries_list", {p_filters:filters,p_cursor:page.cursor??null,p_limit:page.limit??30}),
    tailorEarnings: (tailorId,period = {},page = {}) => call("v1_tailor_earnings", {
      p_tailor_id:tailorId,p_week_start:period.weekStart??null,p_include_team:period.includeTeam??false,p_cursor:page.cursor??null,p_limit:page.limit??30
    }),
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
    configureProduct: (configuration,name,comment,idempotencyKey) => call("v1_product_configure", {
      p_configuration:configuration,p_name:name,p_comment:comment,p_idempotency_key:idempotencyKey
    }),
    presets: (filters = {},page = {}) => call("v1_presets_list", {p_filters:filters,p_cursor:page.cursor??null,p_limit:page.limit??30}),
    renamePreset: (id,name,command) => call("v1_preset_rename", {
      p_id:id,p_name:name,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    saveColor: (targetKind,targetId,name,hex,idempotencyKey) => call("v1_color_save", {
      p_target_kind:targetKind,p_target_id:targetId,p_name:name,p_hex:hex,p_idempotency_key:idempotencyKey
    }),
    overrideQuote: (quoteId,line,unitPrice,reason,command) => call("v1_quote_override", {
      p_quote_id:quoteId,p_line:line,p_unit_price:unitPrice,p_reason:reason,
      p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    saveBranding: (design,command) => call("v1_branding_save", {
      p_id:design.id??null,p_product_id:design.productId??null,p_spec:design.spec,
      p_expected_version:command.expectedVersion??null,p_idempotency_key:command.idempotencyKey
    }),
    placeOrder: (quoteId,details,command) => call("v1_order_place", {
      p_quote_id:quoteId,p_details:details,p_expected_version:command.expectedVersion,
      p_idempotency_key:command.idempotencyKey
    }),
    saveOrderPriority: (id,prime,reason,command) => call("v1_order_priority_save", {
      p_id:id,p_prime:prime,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    saveOrderDue: (id,dueAt,reason,command) => call("v1_order_due_save", {
      p_id:id,p_due_at:dueAt,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    recordOrderPayment: (id,status,paidAmount,reference,command) => call("v1_order_payment_record", {
      p_id:id,p_status:status,p_paid_amount:paidAmount,p_reference:reference,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    cancelOrder: (id,kind,reason,command) => call("v1_order_cancel", {
      p_id:id,p_kind:kind,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    forceCompleteOrder: (id,reason,command) => call("v1_order_force_complete", {
      p_id:id,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    assignFactory: (id,managerId,reason,command) => call("v1_order_assign_factory", {
      p_id:id,p_manager_id:managerId,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    assignWorker: (id,workerId,dueAt,reason,command) => call("v1_order_assign_worker", {
      p_id:id,p_worker_id:workerId,p_due_at:dueAt,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    assignCutter: (id,cutterId,reason,command) => call("v1_item_assign_cutter", {
      p_id:id,p_cutter_id:cutterId,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    saveCriteria: (id,checks,command) => call("v1_item_criteria_save", {
      p_id:id,p_checks:checks,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    saveWorkerCost: (id,unitCost,reason,command) => call("v1_worker_cost_save", {
      p_id:id,p_unit_cost:unitCost,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    saveWorkerStage: (id,stage,reason,command) => call("v1_worker_stage_save", {
      p_id:id,p_stage:stage,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    saveWorkerDue: (id,dueAt,reason,command) => call("v1_worker_due_save", {
      p_id:id,p_due_at:dueAt,p_reason:reason,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    factoryQueue: (filters = {},page = {}) => call("v1_factory_queue", {
      p_factory_id:filters.factoryId??null,p_phase:filters.phase??null,p_cursor:page.cursor??null,p_limit:page.limit??30
    }),
    recordCutting: (id,quantities,occurredAt,command) => call("v1_cutting_record", {
      p_id:id,p_quantities:quantities,p_occurred_at:occurredAt??null,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    inspectJobsheet: (id,quantities,occurredAt,command) => call("v1_jobsheet_inspect", {
      p_id:id,p_quantities:quantities,p_occurred_at:occurredAt??null,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    recordDispatch: (id,quantities,occurredAt,command) => call("v1_dispatch_record", {
      p_id:id,p_quantities:quantities,p_occurred_at:occurredAt??null,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    assignJobsheet: (id,allocations,dueAt,completionBy,command) => call("v1_jobsheet_assign", {
      p_id:id,p_allocations:allocations,p_due_at:dueAt,p_completion_by:completionBy,p_expected_version:command.expectedVersion,p_idempotency_key:command.idempotencyKey
    }),
    cuttingDetail: (id,pages = {}) => call("v1_cutting_detail", {
      p_id:id,p_quantity_cursor:pages.quantityCursor??null,p_history_cursor:pages.historyCursor??null,p_limit:pages.limit??30
    }),
    cuttingQueue: (filters = {},page = {}) => call("v1_cutting_queue", {
      p_completed:filters.completed??false,p_order_id:filters.orderId??null,p_cursor:page.cursor??null,p_limit:page.limit??30
    }),
    dispatchDetail: (id,pages = {}) => call("v1_dispatch_detail", {
      p_id:id,p_quantity_cursor:pages.quantityCursor??null,p_history_cursor:pages.historyCursor??null,p_limit:pages.limit??30
    }),
    dispatchQueue: (filters = {},page = {}) => call("v1_dispatch_queue", {
      p_completed:filters.completed??false,p_order_id:filters.orderId??null,p_cursor:page.cursor??null,p_limit:page.limit??30
    }),
    jobsheets: (filters = {},page = {}) => call("v1_jobsheets_list", {
      p_item_id:filters.itemId??null,p_tailor_id:filters.tailorId??null,p_cursor:page.cursor??null,p_limit:page.limit??30
    }),
    tailorWork: (filters = {},page = {}) => call("v1_tailor_work", {
      p_item_id:filters.itemId??null,p_tailor_id:filters.tailorId??null,p_history:filters.history??false,p_cursor:page.cursor??null,p_limit:page.limit??30
    }),
    productionProgress: (orderId) => call("v1_production_progress", {p_order_id:orderId}),
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
