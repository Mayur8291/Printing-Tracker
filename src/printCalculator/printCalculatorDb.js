import { supabase } from "../supabaseClient";
import {
  parsePriceListDraft,
  priceListPayload,
  priceListsFromRow
} from "./printCalculatorUtils";

const RATE_COLUMNS =
  "internal_rate_1_10, internal_rate_11_200, internal_rate_201_1000, customer_rate_1_10, customer_rate_11_200, customer_rate_201_1000, rate_per_sq_in, updated_at";

export async function fetchPrintCalculatorSettings() {
  const { data, error } = await supabase
    .from("print_calculator_settings")
    .select(RATE_COLUMNS)
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  const legacy = Number(data?.rate_per_sq_in);
  return {
    priceLists: priceListsFromRow(data, Number.isFinite(legacy) && legacy > 0 ? legacy : 1),
    updatedAt: data?.updated_at ?? null
  };
}

export async function savePrintCalculatorRates(draft, userId) {
  const parsed = parsePriceListDraft(draft);
  const { data, error } = await supabase
    .from("print_calculator_settings")
    .upsert({
      id: 1,
      ...priceListPayload(parsed),
      updated_by: userId || null,
      updated_at: new Date().toISOString()
    })
    .select(RATE_COLUMNS)
    .single();
  if (error) throw error;
  const legacy = Number(data?.rate_per_sq_in);
  return {
    priceLists: priceListsFromRow(data, Number.isFinite(legacy) && legacy > 0 ? legacy : 1),
    updatedAt: data.updated_at
  };
}
