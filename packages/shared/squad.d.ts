/** Decimal database IDs are strings to avoid JavaScript integer truncation. */
export type EntityId = string;
export type Version = `${number}:${number}`;
export type Persona = 0|1|2|3|4|7|8|9|10|11|12;
export interface Command { expectedVersion: Version; idempotencyKey: string }
export interface CreateCommand { expectedVersion?: null; idempotencyKey: string }
export interface SavedEntity { id: EntityId; version: Version }
export interface PageRequest { cursor?: string|null; limit?: number }
export interface Page<T> { data: T[]; next_cursor: string|null }
export interface Person {
  id: EntityId; name: string|null; role: number; company_name: string|null;
  first_name: string|null; last_name: string|null; approved: boolean|null;
  onboarded: boolean; disabled: boolean; version: Version;
  /** Present only in an authorized contact projection. */
  email?: string|null; phone?: string|null; factory_id?: EntityId|null;
}
export interface FeatureGrant {key:'1'|'2'|'3';checked:boolean|'true'|'false';children?:Array<{key:'3.1'|'3.2'|'3.3'|'3.4';checked:boolean|'true'|'false'}>}
export interface PersonFields extends ProfileFields {
  email?:string;gst_no?:string|null;designation?:string|null;features?:FeatureGrant[];
  factory_id?:EntityId;manager_id?:EntityId;parent_tailor_id?:EntityId;
}
export interface PersonSaved extends SavedEntity {role:number;account:'queued'|'existing'|'managed_subject';account_request_id:string|null}
export interface AddressFields {address?:string;state?:string;city?:string;zip_code?:string;is_primary?:boolean}
export interface Address extends SavedEntity {address:string|null;state:string|null;city:string|null;zip_code:string|null;is_primary:boolean;used_on_orders:boolean}
export interface AddressSaved extends SavedEntity {
  person_version:Version;addresses:Address[];
  commercial_rules:{zone_id:EntityId|null;price_type_id:EntityId|null;candidate_dealer_ids:EntityId[];dealer_link_mode:'additive_legacy';basis:'registered_dealer'|'primary_city'};
}
export interface PersonDetail extends Person {
  designation:string|null;manager_id?:EntityId|null;parent_tailor_id?:EntityId|null;features?:FeatureGrant[];
  addresses?:Address[];gst_no?:string|null;coordinator_id?:EntityId|null;zone_id?:EntityId|null;price_type_id?:EntityId|null;
  direct_deal?:boolean;auto_approve_customers?:boolean;stock_visibility_percentage?:number;registered_by?:number;dealer_ids?:EntityId[];
  archive_dependencies?:string[];account_request?:null|{id:string;state:'queued'|'processing'|'ready'|'failed'|'discarded';error_code:string|null};
}
export interface PeopleFilters {
  role?:number;search?:string;approved?:Array<boolean|null>;onboarded?:boolean;disabled?:boolean;direct?:boolean;
  coordinator_id?:EntityId;dealer_id?:EntityId;zone_id?:EntityId;price_type_id?:EntityId;registered_by?:Array<0|1|2|3>;
  factory_id?:EntityId;manager_id?:EntityId;parent_tailor_id?:EntityId;
}
export interface Reassignment {people:Array<SavedEntity & {previous_coordinator_id:EntityId|null;coordinator_id:EntityId}>;updated_pending_orders:number;completed_history_preserved:true}
export interface CoordinatorRequest extends SavedEntity {customer_id:EntityId;requested_coordinator_id:EntityId;state:'pending'|'approved'|'rejected'}
export interface CoordinatorRequestDetail extends CoordinatorRequest {customer_version:Version;created_at:string;reason:string|null;decision_reason:string|null}
export interface CommercialRules {price_type_id?:EntityId|null;stock_visibility_percentage?:number;brand_ids?:EntityId[]}
export interface OrderFilters {
  state?: 'pending'|'completed'|'cancelled'|'overdue'|'critical';
  type?: 0|1|2; prime?: boolean; criteria?: 0|1; assigned?: boolean;
  customer_id?: EntityId; created_from?: string; created_before?: string;
  due_before?: string; search?: string; worker_status?: 0|1;
}
export interface OrderSummary {
  id: EntityId; customer_id: EntityId; status: number; provider_status: string;
  created_at: string; created_on: string|null; due_on: string|null; delivered_on: string|null;
  type: 0|1|2; total_quantity: number; cut_quantity: number; sewn_quantity: number;
  dispatched_quantity: number; cutting_status: number; stitching_status: number;
  dispatch_status: number; criteria_status: number; worker_status: number;
  is_prime: boolean; force_completed: boolean; version: Version;
  /** Decimal strings; absent when this persona cannot read commercial data. */
  total_amount?: string; sub_total_amount?: string; branding_amount?: string;
  cgst_amount?: string; sgst_amount?: string; igst_amount?: string;
  payment_status?: number; paid_amount?: string|null;
  factory_manager_id?: EntityId|null; worker_id?: EntityId|null;
}
export interface OrderItem {
  id: EntityId; order_id:EntityId; type: number; product_id: EntityId|null; rmp_class_id: EntityId|null;
  rmp_brand_id: EntityId|null; total_quantity: number; sample_order: boolean|null;
  worker_stage: number|null; cut: number; sewn: number; dispatched: number; version: Version;
  quantities: ItemSize[]; quantities_next_cursor:string|null;
  assigned:number;comment:string|null;comment_truncated:boolean|null;provider_status:string;
  progress:{cutting:number;sample_cutting:number;sample_cut:number;tailor:number;inspection:number;dispatch:number;jobsheet_assigned:boolean;jobsheet_due_at:string|null;jobsheet_completed_at:string|null};
  fabric_consumption?:{per_piece:string;total:string;basis:'stored_order_item'};
  unit_amount?: string; total_amount?: string; worker_unit_cost?: string|null; worker_total_cost?: string|null;
}
export interface ItemSize {id:EntityId;size_id:EntityId;size_name:string|null;quantity:number;cut:number;assigned:number;completed:number;dispatched:number}
export interface ItemSections {
  quantities:ItemSize;
  bulk_plan:{id:EntityId;size_id:EntityId;size_name:string|null;quantity:number};
  brandings:SavedEntity & {type:number;side:string;area:string|null;dimension:string|null;width:string;height:string;unit:string;comment:string|null;parent_id:EntityId|null;image:MediaReference;mockup_image:MediaReference;attachment:MediaReference};
  criteria:{id:EntityId;criteria_id:EntityId;name:string|null;checked:boolean;checked_by_id:EntityId|null;unchecked_by_id:EntityId|null;updated_by_id:EntityId|null;updated_at:string};
  parts:{id:EntityId;part_id:EntityId;name:string|null;color_link_id:EntityId|null;color_id:EntityId|null;color_name:string|null;color_hex:string|null};
  addons:{id:EntityId;product_part_id:EntityId;addon_id:EntityId;name:string|null;color_link_id:EntityId|null;color_id:EntityId|null;color_name:string|null;color_hex:string|null;image:MediaReference};
  images:{id:EntityId;comment:string|null;image:MediaReference};
  source_images:{id:EntityId;image:MediaReference & {pointer:string}};
  variants:{id:EntityId;sku_id:EntityId|null;size_id:EntityId|null;quantity:number;unit_amount?:string;subtotal?:string};
}
export type ItemSection=keyof ItemSections;
export interface ItemProduct {
  id:EntityId;name:string|null;master_basis:'current_referenced_records';style_number?:string|null;comment?:string|null;
  category?:{id:EntityId|null;name:string|null};base_product?:{id:EntityId|null;name:string|null;image:MediaReference};
  fabric?:{id:EntityId|null;name:string|null;type:number|null;uom:string|null;image:MediaReference};color?:{id:EntityId|null;name:string|null;hex:string|null};
  color_id?:EntityId|null;brand_name?:string|null;category_name?:string|null;images?:MediaReference[];video?:MediaReference;
}
export type OrderItemDetail<S extends ItemSection> = Omit<OrderItem,'quantities'|'quantities_next_cursor'> & {product:ItemProduct|null;section:S;records:Page<ItemSections[S]> & {basis?:'accepted_quote'|'not_recorded_in_source'};accepted_pricing_available:boolean};
export interface OrderAmendment extends SavedEntity {state:'applied'|'queued';execution?:'background';amendment_id?:string;request_id?:string;provider_confirmation_required?:boolean;total_amount?:string;proposed_total_amount?:string;paid_amount?:string;items?:Array<{item_id:EntityId;line:number}>}
export interface Dashboard {
  orders: number; pending: number; completed: number; cancelled: number;
  quantity: number; dispatched: number; as_of: string; total_amount?: string;
}
export interface Task extends SavedEntity {
  note:string; state:0|1|2; deadline:string; creator_id:EntityId; order_id:EntityId|null;
  assignee_ids:EntityId[]; updated_at:string;
}
export interface TaskInput { id?:EntityId; note:string; deadline:string; orderId?:EntityId|null; assigneeIds:EntityId[] }
export interface Responsibility extends SavedEntity { subject_id:EntityId;kind:0|1|2;note:string;completed:boolean }
export interface ResponsibilityInput { id?:EntityId;subject_id:EntityId;kind:0|1|2;note:string;expected_version?:Version }
export interface Milestone extends SavedEntity {
  subject_id:EntityId;name:string;start:string;end:string;target_amount:string;
  placed_amount:string;completed_amount:string;order_count:number;achieved:boolean;current:boolean;
}
export interface MilestoneInput { id?:EntityId;subjectId:EntityId;start:string;end:string;amount:string;name:string }
export interface MilestoneProgress {
  id:EntityId;subject_id:EntityId;target_amount:string;placed_amount:string;completed_amount:string;
  order_count:number;year_to_date_placed:string;year_to_date_completed:string;
  period_start_utc:string;period_end_exclusive_utc:string;as_of:string;
}
export interface ProfileFields {
  name?: string; phone?: string|null; company_name?: string|null;
  first_name?: string|null; last_name?: string|null;
}
export interface Me {
  id: EntityId; auth_id: string; role: Persona; name: string|null; email: string;
  phone: string|null; company_name: string|null; first_name: string|null; last_name: string|null;
  approved: boolean|null; onboarded: boolean; version: Version;
  capabilities: Record<'notes'|'goals'|'catalogue'|'configure'|'documents'|'promotions'|'place_orders',boolean>;
}
export interface MediaMutation {resource:string;record_id:EntityId;field:string;status:'ready'|'empty';version:string;entity_version:string}
export interface MediaReference { resource:string;record_id:EntityId;field:string;pointer?:string;status:'ready'|'pending'|'missing'|'external'|'empty' }
export interface CatalogueOption {
  id:EntityId;name:string;position?:number|null;image?:MediaReference;
  base_type_id?:EntityId|null;size_type_id?:EntityId|null;branding_sides?:string|null;
  /** Cost properties only appear for an authorized cost-breakdown capability. */
  costs?:Record<string,string|null>;price?:string;gsm?:string;of?:string;sn?:string;
  type?:number;uom?:string;order_criteria?:string;hex?:string;has_color?:boolean;
  asset?:MediaReference;offset_x?:string|null;offset_y?:string|null;mirror_offset_x?:string|null;height_ratio?:string|null;part_id?:EntityId|null;addon_id?:EntityId|null;
  selection_type?:0|1;group?:string;layer_sort?:number;main_category?:string;authorized_brand_id?:EntityId;
}
export interface CommercialContext { customer_id:EntityId|null;price_type_id:EntityId|null;basis:'regular'|'zone'|'assigned';stock_visibility_percentage:number;generation:number }
export interface CatalogueFilters {base_type_id?:EntityId;category_id?:EntityId;search?:string}
export interface ReadyMadeFilters {brand_id?:EntityId;category_id?:EntityId;color_id?:EntityId;search?:string}
export interface ReadyMadeClass {id:EntityId;name:string;color_id:EntityId;position:number|null;images:MediaReference[];video:MediaReference}
export interface Price {price_id:EntityId;unit_price:string;mrp:string|null;price_type_id:EntityId;fallback:boolean}
export interface ReadyMadeVariant {
  id:EntityId;name:string;size_id:EntityId;size_name:string;size_position:number|null;brand_id:EntityId;category_id:EntityId;price:Price|null;
  availability:{status:'not_loaded';one_day:null;three_day:null;as_of:null};
}
export type ConfiguratorKind='categories'|'fabrics'|'fabric_colors'|'parts'|'part_colors'|'addons'|'addon_colors'|'size_types'|'assets';
export interface Preset extends SavedEntity {name:string;style_number:string;base_product_id:EntityId;fabric_id:EntityId;category_id:EntityId;branding_enabled:boolean;comment?:string;configuration?:Configuration}
export interface Configuration {
  base_product_id:EntityId;fabric_id:EntityId;fabric_color_id:EntityId;category_id:EntityId;
  parts?:Array<{part_id:EntityId;color_id:EntityId;addons?:Array<{addon_id:EntityId;color_id?:EntityId|null}>}>;
}
export interface SizeQuantity {size_id:EntityId;quantity:number}
export interface NormalizedQuantities {quantities:SizeQuantity[];total_quantity:number;sample:SizeQuantity|null;sample_order:boolean}
export interface BrandingInput {type:'print'|'embroidery';side:string;width:string;height:string;unit:'inch';design_id?:EntityId;design_version?:Version}
export interface BrandingSaveInput {id?:EntityId;productId?:EntityId|null;spec:Omit<BrandingInput,'design_id'|'design_version'> & {comment?:string;print_area?:string}}
export interface OrderPlacementDetails {
  due_at:string;comment?:string;
  line_settings?:Record<string,{product_id?:EntityId;comment?:string;size_type_id?:EntityId}>;
  payment?:{status:'paid'|'unpaid'|'partial';paid_amount?:string};
}
export interface OrderPlacement {
  quote_id:string;total_amount:string;paid_amount:string;
  orders:Array<SavedEntity & {items:Array<{line:number;item_id:EntityId}>;total_amount:string;paid_amount:string;rounding_adjustment:string;integration_status:'queued'}>;
}
export interface WorkItemSaved extends SavedEntity {order_version:Version}
export type WorkerStage=0|1|2|3|4|5;
export type ProductionPhase='unassigned'|'criteria'|'cutting'|'sewing'|'dispatch'|'completed';
export interface FactoryQueueItem extends SavedEntity {
  order_id:EntityId;product_id:EntityId|null;manager_id:EntityId|null;cutter_id:EntityId|null;due_at:string|null;
  prime:boolean;sample:boolean;planned_quantity:number;work_quantity:number;cut:number;assigned:number;sewn:number;dispatched:number;held:boolean;
}
export interface ProductionProgress extends SavedEntity {
  status:0|1;provider_status:string;as_of:string;item_count:number;custom_count:number;rmp_count:number;
  cut:number;assigned:number;sewn:number;dispatched:number;cut_complete:boolean;sewn_complete:boolean;assigned_complete:boolean;job_complete:boolean;
  dispatch_complete:boolean;all_dispatch_complete:boolean;worker_complete:boolean;criteria_complete:boolean;
}
export interface WorkQuantityInput {quantity_id:EntityId;quantity:number}
export interface WorkAllocationInput extends WorkQuantityInput {tailor_id:EntityId}
export interface WorkInspectionInput {item_tailor_quantity_id:EntityId;quantity:number}
export interface WorkProgress {required:number;cut:number;assigned:number;sewn:number;dispatched:number;order_completed:boolean}
export interface WorkRecorded extends WorkItemSaved {history_id:EntityId;progress:WorkProgress}
export interface StockReceipt {received:number;dealer_id?:EntityId;state?:'ready'|'awaiting_completion'}
export interface StockAllocation {id:EntityId;receipt_id:EntityId;quantity:number}
export interface DispatchRecorded extends WorkRecorded {stock_receipt:StockReceipt;stock_allocations:StockAllocation[]}
export interface DealerAvailability {stock_status:'ready'|'partial'|'waiting_stock'|'needs_reconciliation'|'complete';available_to_dispatch:number|null;remaining_quantity:number}
export interface DealerStockFilters {kind?:'custom'|'rmp';product_id?:EntityId;rmp_class_id?:EntityId;rmp_brand_id?:EntityId;size_id?:EntityId}
export interface DealerStockBalance {
 id:EntityId;key:string;kind:'rmp'|'custom';size_id:EntityId;product_id:EntityId|null;
 rmp_class_id:EntityId|null;rmp_brand_id:EntityId|null;rmp_category_id:EntityId|null;
 status:'ready'|'needs_reconciliation';available:number|null;
 /** Only dealers receive physical ledger totals. Customers receive the configured display percentage. */
 received?:number;consumed?:number;receipt_count?:number;
}
export interface BackorderPreview {
 preview_id:string;version:Version;expires_at:string;eligible_order_ids:EntityId[];
 excluded:Array<{order_id:EntityId;reason:'closed'|'already_linked'|'assigned_to_production'|'pending_change'}>;
 requirements:Array<{key:string;kind:'custom'|'rmp';size_id:EntityId;product_id:EntityId|null;class_id:EntityId|null;brand_id:EntityId|null;category_id:EntityId|null;required:number;available:number|null;shortage:number|null;received:number;consumed:number;needs_reconciliation:boolean}>;
 lines:QuoteLineInput[];status:'ready'|'no_shortage'|'needs_reconciliation';stock_reservation:'none';quote:Quote|null;
}
export type DispatchMode='not_defined'|'customer'|'ho'|'makali_factory';
export interface DispatchDestination {mode:DispatchMode|'unknown';address:null|{id:EntityId;address:string|null;state:string|null;city:string|null;zip_code:string|null}}
export interface Delivery {id:EntityId;item_id:EntityId;order_id:EntityId;customer_id:EntityId;occurred_at:string|null;quantity:number;size_rows:number;order_state:'pending'|'completed'|'cancelled';history_state:'recorded';destination:DispatchDestination;destination_basis:'dispatch_snapshot'|'current_order_only'}
export interface TailorEarning {id:EntityId;item_id:EntityId;tailor_id:EntityId;base_product_id:EntityId|null;product_name:string|null;assigned:number;completed:number;pending:number;of_rate:string;sn_rate:string;unit_rate:string;amount:string|null;status:'calculated'|'needs_reconciliation'}
export interface TailorEarnings extends Page<TailorEarning> {
 summary:{rows:number;assigned:number;completed:number;pending:number;amount:string|null;calculated_subtotal:string;needs_reconciliation:boolean};
 period:{week_start:string;week_end:string;start_utc:string;end_exclusive_utc:string;timezone:'Asia/Kolkata'};
 basis:{formula:'legacy-tailor-v1';rates:'current_master';addons:'all_linked_base_addons';period:'assignment_date';completion:'current_at_read'};as_of:string;
}
export interface WorkHistoryRow {id:EntityId;history_id:EntityId;quantity_id:EntityId;remaining_before:number;quantity:number;occurred_at:string}
export interface WorkSize {id:EntityId;size_id:EntityId|null;size_name:string|null;quantity:number;cut:number;assigned:number;inspected:number;picked:number;dispatched:number;remaining:number}
export interface WorkDetail extends SavedEntity {order_id:EntityId;product_id:EntityId|null;sample:boolean|null;planned_quantity:number;quantities:Page<WorkSize>;history:Page<WorkHistoryRow>}
export interface WorkQueueItem extends SavedEntity {order_id:EntityId;product_id:EntityId|null;cutter_id:EntityId|null;sample:boolean|null;cut:number;assigned:number;inspected:number;dispatched:number;due_at:string|null;prime:boolean;held:boolean}
export interface JobsheetRow {id:EntityId;item_id:EntityId;quantity_id:EntityId;item_tailor_id:EntityId;tailor_id:EntityId;assignment_id:EntityId;assigned:number;inspected:number;picked:number;occurred_at:string}
export interface TailorWorkRow {id:EntityId;item_id:EntityId;tailor_id:EntityId;item_tailor_quantity_id:EntityId;quantity_id:EntityId;assigned?:number;remaining_before?:number;inspected:number;picked:number;occurred_at:string|null}
export interface WorkDetailPages {quantityCursor?:string;historyCursor?:string;limit?:number}
export type QuoteLineInput = ({kind:'custom';quantities:SizeQuantity[];sample?:SizeQuantity|null;brandings?:BrandingInput[]} & ({configuration:Configuration;preset_id?:never}|{preset_id:EntityId;configuration?:never}))
  | {kind:'rmp';skus:Array<{sku_id:EntityId;quantity:number}>;brandings?:BrandingInput[]};
export interface QuoteRequest {customer_id?:EntityId;address_id:EntityId;lines:QuoteLineInput[]}
export interface QuoteVariant {calculated_unit_price?:string;unit_price:string;quantity:number;sample_rate_applied?:boolean;sku_id?:EntityId;size_id?:EntityId;class_id?:EntityId;brand_id?:EntityId;category_id?:EntityId;price?:Price;display_unit_price?:string}
export interface QuoteLine {
  line:number;kind:'custom'|'rmp';configuration:Configuration|null;quantities:NormalizedQuantities|null;
  variants:QuoteVariant[];branding:{unit_price:string;placements:Array<BrandingInput & {unit_price:string}>};
  quantity:number;subtotal:string;branding_total:string;cgst:string;sgst:string;igst:string;total:string;
  costs?:Record<string,string>;consumption?:string;
}
export interface QuoteCalculation {tax_state:string|null;currency:'INR';pricing_version:string;tax_included:boolean;context:CommercialContext;address_id:EntityId|null;lines:QuoteLine[];quantity:number;subtotal:string;branding_total:string;cgst:string;sgst:string;igst:string;total:string}
export interface Quote extends QuoteCalculation {quote_id:string;version:Version;expires_at:string;fingerprint:string}
export interface Markup {kind:'percentage'|'fixed';value:string}

export interface RpcTransport {
  schema(schema: string): {
    rpc(name: string,args: Record<string,unknown>): PromiseLike<{
      data: unknown; error: null|{message?: string;code?: string}
    }>
  }
}
export class SquadError extends Error {
  code: string; kind: 'session'|'forbidden'|'conflict'|'validation'|'not_found'|'unavailable'|'unexpected';
  constructor(error: {message?: string;code?: string});
}
export interface ReportPeriodRequest {from?:string;before?:string}
export interface ReportPeriod {from:string;before:string;start_utc:string;end_exclusive_utc:string;timezone:'Asia/Kolkata'}
export type SalesReportKind='customers'|'unique_customers'|'brands'|'classes'|'coordinators'|'customer_directory'|'order_items'|'custom_items'|'rmp_items';
export interface SalesReportFilters {status?:'all'|'pending'|'overdue'|'failed'|'completed';customer_id?:EntityId;customer_role?:3|10;zone_id?:EntityId;brand_id?:EntityId;class_id?:EntityId;coordinator_id?:EntityId;order_id?:EntityId;item_id?:EntityId;no_orders?:boolean;comparison?:'previous_period'|'weekly'|'monthly'|'quarterly'|'yearly'}
export interface SalesAggregate {id:EntityId;name:string|null;orders:number;quantity:number|null;subtotal:string|null;branding:string|null;tax:string|null;gross:string|null;closed_quantity:number|null;closed_subtotal:string|null;fill_rate:string|null;dealer_quantity:number|null;dealer_subtotal:string|null;dealer_closed_quantity:number|null;dealer_fill_rate:string|null;customer_quantity:number|null;customer_subtotal:string|null;customer_closed_quantity:number|null;customer_fill_rate:string|null;last_order_at:string;needs_reconciliation:boolean;previous_needs_reconciliation?:boolean;previous_quantity?:number|null;previous_subtotal?:string|null;quantity_difference?:number|null;subtotal_difference?:string|null;quantity_growth_percent?:string|null;subtotal_growth_percent?:string|null;growth_basis?:string}
export interface SalesItem {id:EntityId;order_id:EntityId;kind:0|1;order_kind:0|1|2;ordered_at:string;due_at:string|null;delivered_at:string|null;dispatched_at:string|null;status:number;provider_status:string;customer:{id:EntityId;name:string|null;phone:string|null;role:number;price_type:string|null};coordinator:{id:EntityId|null;name:string|null};created_by:{id:EntityId|null;name:string|null};address:{city:string|null;state:string|null};brand:{id:EntityId|null;name:string|null};class:{id:EntityId|null;name:string|null};color:string|null;category:string|null;quantity:number;size_quantity:number|null;sizes:{id:EntityId;size_id:EntityId;name:string|null;quantity:number|null}[];size_rows:number;sizes_truncated:boolean;quantity_needs_reconciliation:boolean;subtotal:string|null;branding:string|null;tax:string|null;gross:string|null;unit_subtotal:string|null;stored_unit_price:string|null;order_amounts:{subtotal:string|null;branding:string|null;tax:string|null;gross:string|null;line_gross:string|null;difference:string|null;accepted_rounding_adjustment:string|null;basis:'order_header_not_additive_per_item'};remark:string|null;remark_truncated:boolean|null;source_record_id:string|null;feedback:{id:EntityId;rating:string|null;positive_comments:string|null;negative_comments:string|null}|null;product:{id:EntityId;name:string|null;description:string|null}|null;current_master_costs:Record<string,string|number|null>|null;sku:{basis:'inferred_from_legacy_size_name_not_accepted_variant';data:{size_id:EntityId;sku_id:EntityId;name:string;archived:boolean;candidate_count:number}[]}|null}
export interface SalesCustomer {id:EntityId;name:string|null;email:string;phone:string|null;first_name:string|null;last_name:string|null;company_name:string|null;registered_by:number|null;approved:boolean|null;onboarded:boolean|null;gst_no:string|null;source_record_id:string|null;coordinator:{id:EntityId;name:string|null;email:string}|null;first_dealer:{id:EntityId;name:string|null;email:string}|null;dealer_count:number;zone:{id:EntityId|null;name:string|null};price_type:{id:EntityId|null;name:string|null};address:{address:string|null;state:string|null;city:string|null;zip_code:string|null}|null;last_order_at:string|null}
export type SalesReportRow<K extends SalesReportKind>=K extends 'customer_directory'?SalesCustomer:K extends 'order_items'|'custom_items'|'rmp_items'?SalesItem:K extends 'unique_customers'?never:SalesAggregate;
export type SalesReport<K extends SalesReportKind>=Page<SalesReportRow<K>> & {report:K;period:ReportPeriod;as_of:string;basis:Record<string,string>;summary:Record<string,string|number|boolean|null>;previous_period?:ReportPeriod|null};
export interface SalesCoordinatorMetrics {subject_id:EntityId;customers:{current:number;dealers:number|null;pending_approval:number;pending_onboarding:number;new_in_period:number};orders:{total:number;completed:number;cancelled:number;pending:number;unique_customers:number};backlog:{pending:number;pending_criteria:number;overdue:number;critical:number};feedback:{count:number;average:string|null;invalid_source_count:number};sales?:{placed:string|null;completed:string|null;needs_reconciliation:boolean};targets?:Page<Milestone>;target_basis?:string;period:ReportPeriod;as_of:string;basis:Record<string,string>}
export interface TailorRank {id:EntityId;name:string;role:5|6;parent_tailor_id:EntityId|null;position:number;rank:number;assigned:number;completed:number|null;amount?:string|null;needs_reconciliation:boolean}
export interface WorkMetrics {
  cohort:{orders:number;completed:number;cancelled:number;pending:number;completed_on_time:number;completed_with_dates:number;on_time_percent:string|null};
  backlog:{pending_orders:number;overdue_orders:number;critical_orders:number;worker_original_due_overdue:number;worker_original_due_unknown:number;worker_original_due_basis:string};
  factory_balances:{items:number;needs_reconciliation:boolean;invalid_items:number;remaining_cut:number|null;remaining_assignment:number|null;remaining_inspection:number|null;remaining_dispatch:number|null};
  work_in_period:{cut:number;assigned:number;inspected:number;dispatched:number};
  worker_stages:{not_started:number;in_progress:number;completed:number;unknown:number};
  feedback:{count:number;average:string|null;invalid_source_count:number;scope:'visible_received_feedback'};
  period:ReportPeriod;as_of:string;basis:Record<string,string>;
}
export type FeedbackEntity='Order'|'Item';
export interface RatingFields {score:string;positive_comments?:string|null;negative_comments?:string|null}
export interface Rating extends SavedEntity {score:string|null;from_id:EntityId;to_id:EntityId;from_name:string|null;to_name:string|null;from_role:string|null;to_role:string|null;entity_kind:FeedbackEntity;entity_id:EntityId;positive_comments:string|null;negative_comments:string|null;archived:boolean;moderation_reason?:string|null;created_at:string;updated_at:string}
export interface RatingSummary {count:number;valid_count:number;average:string|null;invalid_source_count:number;scope:'visible_feedback_on_entity'}
export type AppPlatform='android'|'ios'|'web';
export interface AppBootstrap {api_version:1;client:'squad';platform:AppPlatform;minimum_version:string|null;recommended_version:string|null;update_url:string|null;update_required:boolean;update_available:boolean;version_check:'unknown_client_version'|'no_minimum_configured'|'checked'}
export interface AppRelease {platform:AppPlatform;minimum_version:string|null;recommended_version:string|null;update_url:string|null;version:Version}
export type SettingsGroup='app_releases'|'integrations'|'cities'|'zones'|'criteria';
export interface IntegrationPreferences {version:Version;airtable_enabled:boolean;warehouse_provider:'dashboard'|'unicommerce';warehouse_provider_mutable:false;imported_airtable_enabled:boolean;provider_configuration:'server_only'}
export interface SettingsMaster extends SavedEntity {name:string;parent_id:EntityId|null;archived:boolean}
export interface Promotion {id:EntityId;name:string|null;category:string|null;upload_date:string|null;file_size:string|null;thumbnail:MediaReference|null;content:null|{kind:'external';url:string;provider:'youtube'|'google_drive'|'vimeo'}|{kind:'file';media:MediaReference|null};updated_at:string}
export interface Banner {id:EntityId;title:string|null;status:string|null;position:number|null;image:MediaReference|null;destination:{brand_id:EntityId|null;category_id:EntityId|null;class_id:EntityId|null};availability:{state:'not_loaded'}}
export type JobState='pending'|'leased'|'done'|'dead';
export interface BackgroundJob {
 id:string;event:string;kind:string;entity_id:EntityId;state:JobState;attempts:number;
 available_at:string;created_at:string;completed_at:string|null;error_code:string|null;
 generation:string;version:Version;handler:string;handler_available:boolean;progress:0|100;
}
export interface JobAttempt {attempt:number;started_at:string;finished_at:string|null;state:'leased'|'done'|'failed'|'expired';error_code:string|null;}
export interface AuditEntry {id:EntityId;actor_id:string;legacy_user_id:EntityId|null;operation:string;kind:string;entity_id:EntityId|null;generation:string;created_at:string;}
export function createSquadClient(supabase: RpcTransport): Readonly<{
  bootstrap(platform:AppPlatform,version?:string|null):Promise<AppBootstrap>;
  saveCapabilities(id:EntityId,features:FeatureGrant[],reason:string,command:Command):Promise<SavedEntity & {features:FeatureGrant[];capabilities:Record<string,boolean>}>;
  promotions(filters?:{mode?:'assets';category?:string;upload_date?:string},page?:PageRequest):Promise<Page<Promotion>>;
  promotions(filters:{mode:'categories'},page?:PageRequest):Promise<Page<{category:string}>>;
  banners(page?:PageRequest):Promise<Page<Banner>>;
  settings(group:'app_releases',page?:PageRequest):Promise<Page<AppRelease> & {legacy_flutter_version:string|null;legacy_version_applied_to_squad:false}>;
  settings(group:'integrations',page?:PageRequest):Promise<IntegrationPreferences>;
  settings(group:'cities'|'zones'|'criteria',page?:PageRequest):Promise<Page<SettingsMaster>>;
  saveSettings(group:'app_releases',id:null,fields:Omit<AppRelease,'version'>,reason:string,command:Command):Promise<AppRelease>;
  saveSettings(group:'integrations',id:null,fields:{airtable_enabled:boolean},reason:string,command:Command):Promise<IntegrationPreferences>;
  saveSettings(group:'cities'|'zones'|'criteria',id:EntityId|null,fields:{name?:string;zone_id?:EntityId;archive?:boolean},reason:string,command:Command|CreateCommand):Promise<SavedEntity & {name:string;archived:boolean}>;
  jobs(state?:JobState|null,page?:PageRequest):Promise<Page<BackgroundJob>>;
  job(id:string):Promise<BackgroundJob & {recent_attempts:JobAttempt[]}>;
  retryJob(id:string,reason:string,command:Command):Promise<BackgroundJob>;
  audit(filters?:{kind?:string;entityId?:EntityId},page?:PageRequest):Promise<Page<AuditEntry>>;
  me(): Promise<Me>;
  reserveMediaUpload(target:{resource:string;record_id:EntityId|null;field:string},file:{filename:string;bytes:string;content_type:string},command:Command):Promise<{upload_id:string;state:string;upload_url?:string;expires_at?:string;bytes?:string;content_type?:string}>;
  verifyMediaUpload(uploadId:string,command:Command):Promise<{upload_id:string;state:'verified'|'attached'}>;
  finalizeMediaUpload(uploadId:string,command:Command):Promise<MediaMutation>;
  detachMedia(target:{resource:string;record_id:EntityId;field:string},reason:string,command:Command):Promise<MediaMutation>;
  mediaGrants(references:Array<Pick<MediaReference,'resource'|'record_id'|'field'|'pointer'>>,options?:{download?:boolean}):Promise<{references:Array<Omit<MediaReference,'status'> & {status:MediaReference['status']|'unavailable'|'external_unavailable';url?:string;expires_in?:number;bytes?:string;content_type?:string;version?:string}>;generation:string;as_of:string}>;
  saveProfile(fields: ProfileFields,command: Command): Promise<Me>;
  people(filters?:PeopleFilters,page?:PageRequest):Promise<Page<Person>>;
  person(id: EntityId): Promise<PersonDetail>;
  savePerson(id:EntityId|null,role:Persona,fields:PersonFields,command:Command|CreateCommand):Promise<PersonSaved>;
  saveFactoryTeam(id:EntityId|null,role:7|8|9,fields:PersonFields,command:Command|CreateCommand):Promise<PersonSaved>;
  saveTailor(id:EntityId|null,fields:Omit<PersonFields,'email'>,command:Command|CreateCommand):Promise<PersonSaved>;
  saveSubtailor(id:EntityId|null,fields:Omit<PersonFields,'email'>,command:Command|CreateCommand):Promise<PersonSaved>;
  archivePerson(id:EntityId,reason:string,command:Command):Promise<SavedEntity & {state:'archived';dependencies:string[]}>;
  factories(search?:string,page?:PageRequest):Promise<Page<SavedEntity & {name:string}>>;
  saveFactory(id:EntityId|null,name:string,command:Command|CreateCommand):Promise<SavedEntity & {name:string}>;
  saveAddress(id:EntityId|null,userId:EntityId,fields:AddressFields,command:Command|CreateCommand):Promise<AddressSaved>;
  archiveAddress(id:EntityId,userId:EntityId,command:Command):Promise<AddressSaved>;
  reviewCustomer(id:EntityId,fields:{approved?:boolean;onboarded?:boolean},reason:string,command:Command):Promise<SavedEntity & {approved:boolean|null;onboarded:boolean;account_reconciliation:'queued';commercial_rules:AddressSaved['commercial_rules']}>;
  saveCustomerLinks(id:EntityId,links:{coordinatorId:EntityId;dealerIds:EntityId[];direct:boolean},reason:string,command:Command):Promise<SavedEntity & {coordinator_id:EntityId;dealer_ids:EntityId[];direct:boolean;rerouted_pending_orders:number;integration:'queued'|'unchanged';commercial_rules:Omit<AddressSaved['commercial_rules'],'dealer_link_mode'> & {dealer_link_mode:'explicit'}}>;
  saveDealerRules(id:EntityId,fields:{auto_approve_customers?:boolean;zone_id?:EntityId|null},reason:string,command:Command):Promise<SavedEntity & {rules:{auto_approve_customers?:boolean;zone_id?:EntityId|null};applies_to:'future_onboarding'}>;
  saveCommercialRules(id:EntityId,fields:CommercialRules,reason:string,command:Command):Promise<SavedEntity & {rules:CommercialRules;pricing_applies_to:'future_quotes'}>;
  reassignCustomers(customers:Array<SavedEntity>,coordinatorId:EntityId,reason:string,idempotencyKey:string):Promise<Reassignment>;
  requestCoordinator(coordinatorId:EntityId,reason:string,idempotencyKey:string):Promise<CoordinatorRequest>;
  coordinatorRequests(filters?:{state?:'pending'|'approved'|'rejected'|'all';customerId?:EntityId},page?:PageRequest):Promise<Page<CoordinatorRequestDetail>>;
  decideCoordinatorRequest(id:EntityId,decision:'approved'|'rejected',reason:string,customerVersion:Version,command:Command):Promise<SavedEntity & {state:'approved'|'rejected';assignment:Reassignment|null}>;
  relationshipOptions(kind:'coordinators'|'dealers'|'cities'|'zones'|'price_types'|'brands',context?:{customerId?:EntityId;search?:string},page?:PageRequest):Promise<Page<{id:EntityId;name:string;parent_id:EntityId|null}>>;
  orders(filters?: OrderFilters,page?: PageRequest): Promise<Page<OrderSummary>>;
  order(id: EntityId,items?: PageRequest): Promise<OrderSummary & {comment:string|null;dispatch_destination:DispatchDestination;items:Page<OrderItem>;pending_change:null|{id:string;kind:'cancel'|'delete'|'edit';state:'queued'|'running';created_at:string}}>;
  ratings(kind:FeedbackEntity,id:EntityId,filters?:{fromId?:EntityId;toId?:EntityId;includeArchived?:boolean},page?:PageRequest):Promise<Page<Rating> & {summary:RatingSummary}>;
  saveRating(id:EntityId|null,kind:FeedbackEntity,entityId:EntityId,toId:EntityId|null,fields:RatingFields,command:Command|CreateCommand):Promise<Rating & {summary:RatingSummary}>;
  archiveRating(id:EntityId,reason:string,command:Command):Promise<SavedEntity & {archived:true;summary:RatingSummary}>;
  dashboard(filters?: OrderFilters): Promise<Dashboard>;
  dealerStock(filters?:DealerStockFilters,context?:{dealerId?:EntityId;customerId?:EntityId},page?:PageRequest):Promise<Page<DealerStockBalance> & {context:{dealer_id:EntityId;customer_id:EntityId;physical:boolean;visibility_percentage:number}}>;
  previewBackorder(orderIds:EntityId[],addressId:EntityId):Promise<BackorderPreview>;
  placeBackorder(previewId:string,dueAt:string,command:Command):Promise<OrderPlacement & {preview_id:string;linked_order_versions:Record<EntityId,Version>;stock_reservation:'none'}>;
  saveDispatchDestination(id:EntityId,destination:DispatchMode,reason:string,command:Command):Promise<SavedEntity & {destination:DispatchDestination}>;
  deliveries(filters?:{from?:string;before?:string;order_id?:EntityId;customer_id?:EntityId},page?:PageRequest):Promise<Page<Delivery>>;
  salesReport<K extends SalesReportKind>(kind:K,period?:ReportPeriodRequest,filters?:SalesReportFilters,page?:PageRequest):Promise<SalesReport<K>>;
  salesCoordinatorMetrics(subjectId?:EntityId|null,period?:ReportPeriodRequest):Promise<SalesCoordinatorMetrics>;
  workMetrics(period?:ReportPeriodRequest,scope?:{subjectId?:EntityId;factoryId?:EntityId}):Promise<WorkMetrics>;
  tailorLeaderboard(factoryId?:EntityId|null,period?:ReportPeriodRequest,page?:PageRequest):Promise<Page<TailorRank> & {summary:{subjects:number;completed:number;needs_reconciliation:boolean};period:ReportPeriod;as_of:string;basis:Record<string,string>}>;
  tailorEarnings(tailorId:EntityId,period?:{weekStart?:string;includeTeam?:boolean},page?:PageRequest):Promise<TailorEarnings>;
  catalogue(kind?:'types'|'categories'|'products',filters?:CatalogueFilters,page?:PageRequest):Promise<Page<CatalogueOption>>;
  baseProduct(id:EntityId):Promise<CatalogueOption>;
  catalogueOptions(kind?:'brands'|'categories'|'sizes'|'price_type',customerId?:EntityId|null,page?:PageRequest):Promise<Page<CatalogueOption> & {context:CommercialContext}>;
  readyMade(filters?:ReadyMadeFilters,customerId?:EntityId|null,page?:PageRequest):Promise<Page<ReadyMadeClass> & {context:CommercialContext}>;
  readyMadeDetail(id:EntityId,customerId?:EntityId|null):Promise<ReadyMadeClass & {context:CommercialContext}>;
  readyMadeVariants(classId:EntityId,customerId?:EntityId|null,filters?:ReadyMadeFilters,page?:PageRequest):Promise<Page<ReadyMadeVariant> & {context:CommercialContext}>;
  configuratorOptions(baseId:EntityId,kind:ConfiguratorKind,selection?:{parentId?:EntityId;partId?:EntityId},page?:PageRequest):Promise<Page<CatalogueOption>>;
  validateQuantities(quantities:SizeQuantity[],sample?:SizeQuantity|null):Promise<NormalizedQuantities>;
  quote(request:QuoteRequest):Promise<Quote>;
  catalogueQuote(request:Omit<QuoteRequest,'address_id'>,markup?:Markup):Promise<QuoteCalculation & {markup:Markup;purpose:'catalogue_display_only'}>;
  configureProduct(configuration:Configuration,name:string,comment:string,idempotencyKey:string):Promise<SavedEntity & {style_number:string;fingerprint:string;reused:boolean}>;
  presets(filters?:{id?:EntityId;base_product_id?:EntityId;style_number?:string;search?:string},page?:PageRequest):Promise<Page<Preset>>;
  renamePreset(id:EntityId,name:string,command:Command):Promise<SavedEntity>;
  saveColor(targetKind:'fabric'|'part'|'addon',targetId:EntityId,name:string,hex:string,idempotencyKey:string):Promise<SavedEntity & {name:string;hex:string;reused:boolean}>;
  overrideQuote(quoteId:string,line:number,unitPrice:string,reason:string,command:Command):Promise<Quote>;
  saveBranding(design:BrandingSaveInput,command:Command|CreateCommand):Promise<SavedEntity & {product_id:EntityId|null}>;
  placeOrder(quoteId:string,details:OrderPlacementDetails,command:Command):Promise<OrderPlacement>;
  editOrder(id:EntityId,quoteId:string,quoteVersion:Version,details:OrderPlacementDetails,reason:string,command:Command):Promise<OrderAmendment>;
  orderItem<S extends ItemSection='quantities'>(id:EntityId,section?:S,page?:PageRequest):Promise<OrderItemDetail<S>>;
  saveOrderPriority(id:EntityId,prime:boolean,reason:string,command:Command):Promise<SavedEntity & {is_prime:boolean}>;
  saveOrderDue(id:EntityId,dueAt:string,reason:string,command:Command):Promise<SavedEntity & {due_at:string}>;
  recordOrderPayment(id:EntityId,status:'paid'|'unpaid'|'partial',paidAmount:string,reference:string,command:Command):Promise<SavedEntity & {payment_status:0|1|2;paid_amount:string}>;
  cancelOrder(id:EntityId,kind:'cancel'|'delete',reason:string,command:Command):Promise<SavedEntity & {state:'queued'|'cancelled'|'deleted';request_id:string|null}>;
  forceCompleteOrder(id:EntityId,reason:string,command:Command):Promise<SavedEntity & {status:1;force_completed:true}>;
  assignFactory(id:EntityId,managerId:EntityId|null,reason:string,command:Command):Promise<SavedEntity & {manager_id:EntityId|null;factory_id:EntityId|null}>;
  assignWorker(id:EntityId,workerId:EntityId,dueAt:string,reason:string,command:Command):Promise<SavedEntity & {worker_id:EntityId;due_at:string}>;
  assignCutter(id:EntityId,cutterId:EntityId|null,reason:string,command:Command):Promise<WorkItemSaved & {cutter_id:EntityId|null}>;
  saveCriteria(id:EntityId,checks:Array<{id:EntityId;checked:boolean}>,command:Command):Promise<WorkItemSaved & {criteria_complete:boolean}>;
  saveWorkerCost(id:EntityId,unitCost:string,reason:string,command:Command):Promise<WorkItemSaved & {unit_cost:string;total_cost:string}>;
  saveWorkerStage(id:EntityId,stage:WorkerStage,reason:string,command:Command):Promise<WorkItemSaved & {stage:WorkerStage;order_completed:boolean;stock_receipt:StockReceipt}>;
  saveWorkerDue(id:EntityId,dueAt:string,reason:string,command:Command):Promise<SavedEntity & {due_at:string;original_due_at:string;baseline_basis:'assignment'|'first_observed_change';delta_days:number}>;
  factoryQueue(filters?:{factoryId?:EntityId;phase?:ProductionPhase},page?:PageRequest):Promise<Page<FactoryQueueItem>>;
  recordCutting(id:EntityId,quantities:WorkQuantityInput[],occurredAt:string|null,command:Command):Promise<WorkRecorded>;
  inspectJobsheet(id:EntityId,quantities:WorkInspectionInput[],occurredAt:string|null,command:Command):Promise<WorkRecorded>;
  recordDispatch(id:EntityId,quantities:WorkQuantityInput[],occurredAt:string|null,command:Command):Promise<DispatchRecorded>;
  assignJobsheet(id:EntityId,allocations:WorkAllocationInput[],dueAt:string,completionBy:string,command:Command):Promise<WorkRecorded>;
  cuttingDetail(id:EntityId,pages?:WorkDetailPages):Promise<WorkDetail>;
  dispatchDetail(id:EntityId,pages?:WorkDetailPages):Promise<WorkDetail & Partial<DealerAvailability>>;
  cuttingQueue(filters?:{completed?:boolean;orderId?:EntityId},page?:PageRequest):Promise<Page<WorkQueueItem>>;
  dispatchQueue(filters?:{completed?:boolean;orderId?:EntityId},page?:PageRequest):Promise<Page<WorkQueueItem & Partial<DealerAvailability>>>;
  jobsheets(filters?:{itemId?:EntityId;tailorId?:EntityId},page?:PageRequest):Promise<Page<JobsheetRow>>;
  tailorWork(filters?:{itemId?:EntityId;tailorId?:EntityId;history?:boolean},page?:PageRequest):Promise<Page<TailorWorkRow>>;
  productionProgress(orderId:EntityId):Promise<ProductionProgress>;
  tasks(filters?: {state?:0|1|2;orderId?:EntityId},page?:PageRequest):Promise<Page<Task>>;
  task(id:EntityId):Promise<Task>;
  taskAssignees(page?:PageRequest):Promise<Page<{id:EntityId;name:string;role:number}>>;
  saveTask(task:TaskInput,command:Command|CreateCommand):Promise<SavedEntity>;
  transitionTask(id:EntityId,state:0|1|2,command:Command):Promise<SavedEntity & {state:0|1|2}>;
  responsibilities(filters?:{subjectId?:EntityId;kind?:0|1|2;completed?:boolean},page?:PageRequest):Promise<Page<Responsibility>>;
  saveResponsibilities(items:ResponsibilityInput[],idempotencyKey:string):Promise<{items:Array<SavedEntity & {subject_id:EntityId}>}>;
  transitionResponsibility(id:EntityId,state:'pending'|'completed'|'archived',reason:string|null,command:Command):Promise<SavedEntity & {state:string}>;
  milestones(subjectId?:EntityId,page?:PageRequest):Promise<Page<Milestone>>;
  milestoneProgress(id:EntityId):Promise<MilestoneProgress>;
  saveMilestone(target:MilestoneInput,command:Command|CreateCommand):Promise<SavedEntity>;
  archiveMilestone(id:EntityId,reason:string,command:Command):Promise<SavedEntity & {archived:true}>;
}>;
