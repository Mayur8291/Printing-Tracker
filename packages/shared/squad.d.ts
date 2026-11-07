/** Decimal database IDs are strings to avoid JavaScript integer truncation. */
export type EntityId = string;
export type Version = `${number}:${number}`;
export type Persona = 0|1|2|3|4|7|8|9|10|11|12;
export interface Command { expectedVersion: Version; idempotencyKey: string }
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
  code: string; kind: 'session'|'forbidden'|'conflict'|'validation'|'unavailable'|'unexpected';
  constructor(error: {message?: string;code?: string});
}
export function createSquadClient(supabase: RpcTransport): Readonly<{
  me(): Promise<Me>;
  saveProfile(fields: ProfileFields,command: Command): Promise<Me>;
}>;
