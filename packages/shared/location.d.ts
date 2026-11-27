export interface CanonicalState { state: string; cities: string[] }
export interface CanonicalLocation { state: string; city: string }
/** Canonical source-backed values; use them for both clients. */
export const states: CanonicalState[];
export function canonicalState(value: unknown): CanonicalState | null;
export function canonicalLocation(state: unknown, city: unknown): CanonicalLocation | null;
export function locationError(state: unknown, city: unknown, options?: { legacy?: CanonicalLocation | null; allowLegacy?: boolean }): string | null;
