import { supabase } from "../supabaseClient";

const DEFAULT_RATE = 1;

export async function fetchPrintCalculatorSettings() {
  const { data, error } = await supabase
    .from("print_calculator_settings")
    .select("rate_per_sq_in, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  const rate = Number(data?.rate_per_sq_in);
  return {
    ratePerSqIn: Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_RATE,
    updatedAt: data?.updated_at ?? null
  };
}

export async function savePrintCalculatorRate(ratePerSqIn, userId) {
  const rate = Number(ratePerSqIn);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Rate per square inch must be greater than zero.");
  }
  const { data, error } = await supabase
    .from("print_calculator_settings")
    .upsert({
      id: 1,
      rate_per_sq_in: rate,
      updated_by: userId || null,
      updated_at: new Date().toISOString()
    })
    .select("rate_per_sq_in, updated_at")
    .single();
  if (error) throw error;
  return {
    ratePerSqIn: Number(data.rate_per_sq_in),
    updatedAt: data.updated_at
  };
}
