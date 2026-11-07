export type Environment = "staging" | "production";
export type DataSource = "legacy" | "supabase";
export const APPLICATION_NAME: "Canto";
export const ENVIRONMENTS: Readonly<Record<Environment, Readonly<{ label: string; projectRef: string }>>>;
export const DATA_SOURCES: readonly DataSource[];
export function requireEnvironment(value: unknown): Environment;
