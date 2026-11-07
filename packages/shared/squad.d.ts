/** Decimal database IDs are strings to avoid JavaScript integer truncation. */
export type EntityId = string;
export type Version = `${number}:${number}`;
export type Persona = 0|1|2|3|4|7|8|9|10|11|12;
export interface Command { expectedVersion: Version; idempotencyKey: string }
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
  order(id: EntityId,items?: PageRequest): Promise<OrderSummary & {comment:string|null;items:Page<OrderItem>}>;
  dashboard(filters?: OrderFilters): Promise<Dashboard>;
}>;
