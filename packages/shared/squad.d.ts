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
  email?: string; phone?: string|null; factory_id?: EntityId|null;
}
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
  id: EntityId; type: number; product_id: EntityId|null; rmp_class_id: EntityId|null;
  rmp_brand_id: EntityId|null; total_quantity: number; sample_order: boolean|null;
  worker_stage: number|null; cut: number; sewn: number; dispatched: number; version: Version;
  quantities: Array<{id:EntityId;size_id:EntityId;quantity:number;cut:number;assigned:number;completed:number;dispatched:number}>;
  unit_amount?: string; total_amount?: string; worker_unit_cost?: string|null; worker_total_cost?: string|null;
}
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
export interface MediaReference { resource:string;record_id:EntityId;field:string;status:'ready'|'pending'|'missing'|'external'|'empty' }
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
export type QuoteLineInput = {kind:'custom';configuration:Configuration;quantities:SizeQuantity[];sample?:SizeQuantity|null;brandings?:BrandingInput[]}
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
export function createSquadClient(supabase: RpcTransport): Readonly<{
  me(): Promise<Me>;
  saveProfile(fields: ProfileFields,command: Command): Promise<Me>;
  people(filters?: {role?: number;search?: string},page?: PageRequest): Promise<Page<Person>>;
  person(id: EntityId): Promise<Person>;
  orders(filters?: OrderFilters,page?: PageRequest): Promise<Page<OrderSummary>>;
  order(id: EntityId,items?: PageRequest): Promise<OrderSummary & {comment:string|null;items:Page<OrderItem>;pending_change:null|{id:string;kind:'cancel'|'delete'|'edit';state:'queued'|'running';created_at:string}}>;
  dashboard(filters?: OrderFilters): Promise<Dashboard>;
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
  saveOrderPriority(id:EntityId,prime:boolean,reason:string,command:Command):Promise<SavedEntity & {is_prime:boolean}>;
  saveOrderDue(id:EntityId,dueAt:string,reason:string,command:Command):Promise<SavedEntity & {due_at:string}>;
  recordOrderPayment(id:EntityId,status:'paid'|'unpaid'|'partial',paidAmount:string,reference:string,command:Command):Promise<SavedEntity & {payment_status:0|1|2;paid_amount:string}>;
  cancelOrder(id:EntityId,kind:'cancel'|'delete',reason:string,command:Command):Promise<SavedEntity & {state:'queued'|'cancelled'|'deleted';request_id:string|null}>;
  forceCompleteOrder(id:EntityId,reason:string,command:Command):Promise<SavedEntity & {status:1;force_completed:true}>;
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
