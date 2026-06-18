import { supabase } from "./supabaseClient";

export const PRINTING_UTILIZATION_SELECT =
  "id, printing_metres, pcs_fused, created_at, created_by";

export function formatPrintingUtilizationDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export function formatPrintingMetres(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatPcsFused(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export async function fetchPrintingUtilizationEntries(limit = 500) {
  const { data, error } = await supabase
    .from("printing_utilization_entries")
    .select(PRINTING_UTILIZATION_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createPrintingUtilizationEntry({ printingMetres, pcsFused, userId }) {
  const metres = Number(printingMetres);
  const pcs = Number(pcsFused);
  if (!userId) throw new Error("You must be signed in to save an entry.");
  if (!Number.isFinite(metres) || metres <= 0) {
    throw new Error("Enter printing metres greater than 0.");
  }
  if (!Number.isInteger(pcs) || pcs <= 0) {
    throw new Error("Enter number of pcs fused as a whole number greater than 0.");
  }

  const { data, error } = await supabase
    .from("printing_utilization_entries")
    .insert({
      printing_metres: metres,
      pcs_fused: pcs,
      created_by: userId
    })
    .select(PRINTING_UTILIZATION_SELECT)
    .single();

  if (error) throw new Error(error.message);
  return data;
}
