import { supabase } from "./supabaseClient";

export const PRINTING_DEPT_MATERIALS = [
  { key: "ink_cyan", label: "Cyan (C)", column: "ink_cyan", unit: "L", color: "#0891b2", group: "Ink" },
  { key: "ink_magenta", label: "Magenta (M)", column: "ink_magenta", unit: "L", color: "#db2777", group: "Ink" },
  { key: "ink_yellow", label: "Yellow (Y)", column: "ink_yellow", unit: "L", color: "#ca8a04", group: "Ink" },
  { key: "ink_black", label: "Black (K)", column: "ink_black", unit: "L", color: "#1e293b", group: "Ink" },
  { key: "ink_white", label: "White (W)", column: "ink_white", unit: "L", color: "#e2e8f0", group: "Ink" },
  { key: "roll_count", label: "Rolls", column: "roll_count", unit: "rolls", color: "#6366f1", group: "Materials" },
  { key: "powder_kg", label: "Powder", column: "powder_kg", unit: "kg", color: "#a16207", group: "Materials" },
  {
    key: "cleaning_solution_count",
    label: "Cleaning solution",
    column: "cleaning_solution_count",
    unit: "units",
    color: "#0d9488",
    group: "Materials"
  }
];

export const PRINTING_UTILIZATION_MATERIAL_KEYS = new Set([
  "ink_cyan",
  "ink_magenta",
  "ink_yellow",
  "ink_black",
  "ink_white",
  "roll_count",
  "powder_kg"
]);

const MATERIAL_BY_KEY = Object.fromEntries(PRINTING_DEPT_MATERIALS.map((m) => [m.key, m]));

export function materialLabel(materialKey) {
  return MATERIAL_BY_KEY[materialKey]?.label ?? materialKey;
}

export function materialUnit(materialKey) {
  return MATERIAL_BY_KEY[materialKey]?.unit ?? "";
}

export function inventoryItemsFromState(state) {
  if (!state) return [];
  return PRINTING_DEPT_MATERIALS.map((material) => ({
    ...material,
    quantity: Number(state[material.column] ?? 0)
  }));
}

function localDayKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayLabel(dayKey) {
  if (!dayKey) return "—";
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export const MATERIAL_SHORT_CODE = {
  ink_cyan: "C",
  ink_magenta: "M",
  ink_yellow: "Y",
  ink_black: "K",
  ink_white: "W",
  roll_count: "R",
  powder_kg: "P",
  cleaning_solution_count: "CL"
};

const MATERIAL_DISPLAY_ORDER = [
  "ink_cyan",
  "ink_magenta",
  "ink_yellow",
  "ink_black",
  "ink_white",
  "roll_count",
  "powder_kg",
  "cleaning_solution_count"
];

function sortByMaterialOrder(entries) {
  return [...entries].sort(
    (a, b) => MATERIAL_DISPLAY_ORDER.indexOf(a.materialKey) - MATERIAL_DISPLAY_ORDER.indexOf(b.materialKey)
  );
}

export function buildMovementHistoryDayGroups(historyRows, { days = 90 } = {}) {
  const byDay = new Map();

  for (const row of historyRows ?? []) {
    const day = localDayKey(row.created_at);
    if (!day) continue;
    if (!byDay.has(day)) {
      byDay.set(day, { date: day, dateLabel: formatDayLabel(day), entries: [] });
    }
    byDay.get(day).entries.push(row);
  }

  return [...byDay.values()]
    .map((day) => {
      const entries = [...day.entries].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const entriesAsc = [...day.entries].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

      const netByMaterial = {};
      const inByMaterial = {};
      const outByMaterial = {};
      const closingByMaterial = {};

      for (const row of entriesAsc) {
        const key = row.material_key;
        const qty = Number(row.quantity_added ?? 0);
        const isIssue = (row.movement_type ?? "refill") === "issue";
        const delta = isIssue ? -qty : qty;
        netByMaterial[key] = (netByMaterial[key] ?? 0) + delta;
        if (isIssue) {
          outByMaterial[key] = (outByMaterial[key] ?? 0) + qty;
        } else {
          inByMaterial[key] = (inByMaterial[key] ?? 0) + qty;
        }
        closingByMaterial[key] = Number(row.quantity_after ?? 0);
      }

      const overviewChanges = sortByMaterialOrder(
        Object.keys({ ...inByMaterial, ...outByMaterial }).flatMap((materialKey) => {
          const chips = [];
          const added = inByMaterial[materialKey] ?? 0;
          const used = outByMaterial[materialKey] ?? 0;
          if (added > 0) {
            chips.push({
              materialKey,
              shortCode: MATERIAL_SHORT_CODE[materialKey] ?? materialKey,
              net: added,
              direction: "in"
            });
          }
          if (used > 0) {
            chips.push({
              materialKey,
              shortCode: MATERIAL_SHORT_CODE[materialKey] ?? materialKey,
              net: -used,
              direction: "out"
            });
          }
          return chips;
        })
      );

      const netChanges = sortByMaterialOrder(
        Object.entries(netByMaterial)
          .filter(([, net]) => net !== 0)
          .map(([materialKey, net]) => ({
            materialKey,
            shortCode: MATERIAL_SHORT_CODE[materialKey] ?? materialKey,
            net
          }))
      );

      const closingStocks = sortByMaterialOrder(
        Object.entries(closingByMaterial).map(([materialKey, value]) => ({
          materialKey,
          shortCode: MATERIAL_SHORT_CODE[materialKey] ?? materialKey,
          value
        }))
      );

      return { ...day, entries, overviewChanges, netChanges, closingStocks };
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days);
}

export async function fetchPrintingDeptInventoryState() {
  const { data, error } = await supabase.from("printing_dept_inventory_state").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchPrintingDeptInventoryHistory(limit = 80) {
  const { data, error } = await supabase
    .from("printing_dept_refill_log")
    .select("id, material_key, movement_type, quantity_added, quantity_after, note, created_at, refilled_by")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** @deprecated use fetchPrintingDeptInventoryHistory */
export const fetchPrintingDeptRefillHistory = fetchPrintingDeptInventoryHistory;

export async function fetchPrintingDeptThresholds() {
  const { data, error } = await supabase
    .from("printing_dept_inventory_thresholds")
    .select("material_key, low_stock_threshold");
  if (error) throw new Error(error.message);
  const map = {};
  for (const row of data ?? []) {
    map[row.material_key] = Number(row.low_stock_threshold ?? 0);
  }
  return map;
}

export async function savePrintingDeptThresholds({ thresholds, userId, isAdmin = false }) {
  if (!isAdmin) throw new Error("Only admins can set printing inventory thresholds.");
  if (!userId) throw new Error("You must be signed in to save thresholds.");
  const rows = Object.entries(thresholds ?? {}).map(([materialKey, value]) => ({
    material_key: materialKey,
    low_stock_threshold: Number(value) || 0,
    updated_at: new Date().toISOString(),
    updated_by: userId
  }));
  const { error } = await supabase.from("printing_dept_inventory_thresholds").upsert(rows, {
    onConflict: "material_key"
  });
  if (error) throw new Error(error.message);
}

export function isPrintingMaterialLowStock(quantity, threshold) {
  const limit = Number(threshold);
  const stock = Number(quantity);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return stock < limit;
}

async function recordPrintingDeptMovement({ materialKey, quantity, userId, note = "", movementType }) {
  const material = MATERIAL_BY_KEY[materialKey];
  const amount = Number(quantity);
  if (!material || !userId || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter a valid amount.");
  }
  if (movementType !== "refill" && movementType !== "issue") {
    throw new Error("Invalid movement type.");
  }

  const { data: state, error: stateErr } = await supabase
    .from("printing_dept_inventory_state")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (stateErr) throw new Error(stateErr.message);
  if (!state) throw new Error("Printing inventory not initialized. Run the latest database migration.");

  const current = Number(state[material.column] ?? 0);
  const after = movementType === "refill" ? current + amount : current - amount;
  if (after < 0) {
    throw new Error(`Not enough ${material.label} in stock. Available: ${current} ${material.unit}.`);
  }

  const { error: updateErr } = await supabase
    .from("printing_dept_inventory_state")
    .update({
      [material.column]: after,
      updated_at: new Date().toISOString(),
      updated_by: userId
    })
    .eq("id", 1);
  if (updateErr) throw new Error(updateErr.message);

  const { error: logErr } = await supabase.from("printing_dept_refill_log").insert({
    material_key: materialKey,
    movement_type: movementType,
    quantity_added: amount,
    quantity_after: after,
    refilled_by: userId,
    note: String(note ?? "").trim()
  });
  if (logErr) throw new Error(logErr.message);

  return {
    materialKey,
    quantity: amount,
    quantityAfter: after,
    previousStock: current,
    movementType
  };
}

export function refillPrintingDeptMaterial({ materialKey, quantityAdded, userId, note = "" }) {
  return recordPrintingDeptMovement({
    materialKey,
    quantity: quantityAdded,
    userId,
    note,
    movementType: "refill"
  });
}

export function issuePrintingDeptMaterial({ materialKey, quantityUsed, userId, note = "" }) {
  return recordPrintingDeptMovement({
    materialKey,
    quantity: quantityUsed,
    userId,
    note,
    movementType: "issue"
  });
}

export async function notifyPrintingLowStockIfNeeded({ materialKey, previousStock, newStock, userId }) {
  const { maybeNotifyPrintingInventoryLowStock } = await import("./printingDeptInventoryNotificationUtils");
  const thresholds = await fetchPrintingDeptThresholds();
  return maybeNotifyPrintingInventoryLowStock({
    materialKey,
    previousStock,
    newStock,
    threshold: thresholds[materialKey] ?? 0,
    triggeredByUserId: userId
  });
}
