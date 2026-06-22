import { todayLocalISODate } from "./inwardEntryUtils";

export const GRN_SIZE_KEYS = ["S", "M", "L", "XL", "XXL"];

export const GRN_TYPE_APPAREL = "apparel";
export const GRN_TYPE_FABRIC = "fabric";

function trimField(value) {
  return String(value ?? "").trim();
}

export function grnUid() {
  return `r${Math.random().toString(36).slice(2, 9)}`;
}

export function grnParseInt(value) {
  const parsed = parseInt(String(value ?? ""), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function grnParseFloat(value) {
  const parsed = parseFloat(String(value ?? ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function emptyGrnProduct() {
  return { id: grnUid(), name: "", S: "", M: "", L: "", XL: "", XXL: "" };
}

export function emptyGrnBora(label = "Bora 1") {
  return { id: grnUid(), label, products: [emptyGrnProduct()] };
}

export function emptyGrnFabricLine() {
  return { id: grnUid(), ftype: "", color: "", gsm: "", rolls: "", kgs: "", lot: "" };
}

export function emptyGrnHeader() {
  return {
    grnNo: "",
    date: todayLocalISODate(),
    supplier: "",
    invoiceNo: "",
    location: "",
    forWhom: "",
    receivedBy: "",
    remark: ""
  };
}

export function emptyGrnFormState(type = GRN_TYPE_APPAREL) {
  return {
    type,
    header: emptyGrnHeader(),
    boras: [emptyGrnBora()],
    fabrics: [emptyGrnFabricLine()]
  };
}

export function computeGrnTotals(state) {
  const sizeTotals = { S: 0, M: 0, L: 0, XL: 0, XXL: 0 };
  let totalProducts = 0;

  const boraGroups = (state.boras ?? []).map((bora, index) => {
    const boraSizeTotals = { S: 0, M: 0, L: 0, XL: 0, XXL: 0 };
    const products = (bora.products ?? []).map((product) => {
      const total = GRN_SIZE_KEYS.reduce((sum, key) => sum + grnParseInt(product[key]), 0);
      GRN_SIZE_KEYS.forEach((key) => {
        boraSizeTotals[key] += grnParseInt(product[key]);
      });
      return { ...product, total };
    });
    totalProducts += products.length;
    GRN_SIZE_KEYS.forEach((key) => {
      sizeTotals[key] += boraSizeTotals[key];
    });
    const boraTotal = GRN_SIZE_KEYS.reduce((sum, key) => sum + boraSizeTotals[key], 0);
    return {
      id: bora.id,
      seq: index + 1,
      label: bora.label,
      products,
      sizeTotals: boraSizeTotals,
      total: boraTotal
    };
  });

  const grandPieces = GRN_SIZE_KEYS.reduce((sum, key) => sum + sizeTotals[key], 0);
  const fabricRows = state.fabrics ?? [];
  const totalRolls = fabricRows.reduce((sum, row) => sum + grnParseInt(row.rolls), 0);
  const totalKgs = fabricRows.reduce((sum, row) => sum + grnParseFloat(row.kgs), 0);
  const totalKgsDisplay = (Math.round(totalKgs * 100) / 100).toString();

  return {
    boraGroups,
    sizeTotals,
    grandPieces,
    totalBoras: state.boras?.length ?? 0,
    totalProducts,
    fabricRows,
    totalRolls,
    totalKgs,
    totalKgsDisplay,
    fabricLines: fabricRows.length
  };
}

export function buildGrnStatChips(state, totals) {
  const dash = (value) => (trimField(value) ? value : "—");
  const isApparel = state.type === GRN_TYPE_APPAREL;
  if (isApparel) {
    return [
      { label: "Total Boras", value: String(totals.totalBoras), unit: "" },
      { label: "Total Products", value: String(totals.totalProducts), unit: "" },
      { label: "Total Pieces", value: String(totals.grandPieces), unit: "pcs" },
      { label: "Storage", value: dash(state.header?.location), unit: "" }
    ];
  }
  return [
    { label: "Fabric Lots", value: String(totals.fabricLines), unit: "" },
    { label: "Total Rolls/Than", value: String(totals.totalRolls), unit: "" },
    { label: "Total Weight", value: totals.totalKgsDisplay, unit: "kg" },
    { label: "Storage", value: dash(state.header?.location), unit: "" }
  ];
}

export function aggregateGrnSizeBreakdown(sizeTotals) {
  const breakdown = {};
  for (const key of GRN_SIZE_KEYS) {
    const qty = sizeTotals[key] ?? 0;
    if (qty > 0) breakdown[key] = qty;
  }
  return Object.keys(breakdown).length ? breakdown : null;
}

export function serializeGrnDetail(state) {
  return {
    version: 1,
    type: state.type,
    header: {
      date: trimField(state.header?.date),
      forWhom: trimField(state.header?.forWhom),
      receivedBy: trimField(state.header?.receivedBy),
      remark: trimField(state.header?.remark)
    },
    boras: (state.boras ?? []).map((bora) => ({
      id: bora.id,
      label: trimField(bora.label),
      products: (bora.products ?? []).map((product) => ({
        id: product.id,
        name: trimField(product.name),
        S: trimField(product.S),
        M: trimField(product.M),
        L: trimField(product.L),
        XL: trimField(product.XL),
        XXL: trimField(product.XXL)
      }))
    })),
    fabrics: (state.fabrics ?? []).map((row) => ({
      id: row.id,
      ftype: trimField(row.ftype),
      color: trimField(row.color),
      gsm: trimField(row.gsm),
      rolls: trimField(row.rolls),
      kgs: trimField(row.kgs),
      lot: trimField(row.lot)
    }))
  };
}

export function deserializeGrnDetail(detail) {
  if (!detail || typeof detail !== "object") return null;
  const type = detail.type === GRN_TYPE_FABRIC ? GRN_TYPE_FABRIC : GRN_TYPE_APPAREL;
  const headerExtra = detail.header ?? {};
  const boras = Array.isArray(detail.boras) && detail.boras.length
    ? detail.boras.map((bora, index) => ({
        id: bora.id || grnUid(),
        label: trimField(bora.label) || `Bora ${index + 1}`,
        products: Array.isArray(bora.products) && bora.products.length
          ? bora.products.map((product) => ({
              id: product.id || grnUid(),
              name: product.name ?? "",
              S: product.S ?? "",
              M: product.M ?? "",
              L: product.L ?? "",
              XL: product.XL ?? "",
              XXL: product.XXL ?? ""
            }))
          : [emptyGrnProduct()]
      }))
    : [emptyGrnBora()];
  const fabrics = Array.isArray(detail.fabrics) && detail.fabrics.length
    ? detail.fabrics.map((row) => ({
        id: row.id || grnUid(),
        ftype: row.ftype ?? "",
        color: row.color ?? "",
        gsm: row.gsm ?? "",
        rolls: row.rolls ?? "",
        kgs: row.kgs ?? "",
        lot: row.lot ?? ""
      }))
    : [emptyGrnFabricLine()];
  return {
    type,
    headerPatch: {
      date: headerExtra.date ?? todayLocalISODate(),
      forWhom: headerExtra.forWhom ?? "",
      receivedBy: headerExtra.receivedBy ?? "",
      remark: headerExtra.remark ?? ""
    },
    boras,
    fabrics
  };
}

export function grnFormStateFromRecord(record) {
  const base = emptyGrnFormState();
  base.header = {
    ...base.header,
    grnNo: record?.grn_no ?? "",
    supplier: record?.supplier ?? "",
    invoiceNo: record?.invoice_no ?? "",
    location: record?.location_rack ?? "",
    forWhom: record?.for_whom ?? "",
    receivedBy: record?.received_by ?? "",
    remark: record?.remark ?? ""
  };
  const detail = deserializeGrnDetail(record?.grn_entry_detail);
  if (detail) {
    base.type = detail.type;
    base.header = { ...base.header, ...detail.headerPatch };
    base.boras = detail.boras;
    base.fabrics = detail.fabrics;
  }
  return base;
}

export function validateGrnForm(state) {
  const header = state.header ?? {};
  if (!trimField(header.grnNo)) return "GRN NO. is required.";
  if (!trimField(header.forWhom)) return "For whom is required.";
  if (!trimField(header.supplier)) return "Supplier is required.";
  if (!trimField(header.location)) return "Storage location is required.";
  if (!trimField(header.receivedBy)) return "Received by is required.";

  const totals = computeGrnTotals(state);
  if (state.type === GRN_TYPE_APPAREL) {
    if (totals.grandPieces <= 0) return "Enter at least one piece qty in apparel lines.";
  } else if (totals.totalRolls <= 0 && totals.totalKgs <= 0) {
    return "Enter rolls or weight for at least one fabric line.";
  }
  return null;
}

export function inwardGrnToInsertPayloadFromState(state, inwardEntryId, sessionUserId) {
  const totals = computeGrnTotals(state);
  const header = state.header ?? {};
  const isApparel = state.type === GRN_TYPE_APPAREL;
  const qtyReceived = isApparel ? String(totals.grandPieces) : totals.totalKgsDisplay;
  const boraCartonUnit = isApparel
    ? String(totals.totalBoras)
    : String(totals.fabricLines);
  const sizeBreakdown = isApparel ? aggregateGrnSizeBreakdown(totals.sizeTotals) : null;

  return {
    inward_entry_id: inwardEntryId,
    grn_no: trimField(header.grnNo),
    for_whom: trimField(header.forWhom),
    supplier: trimField(header.supplier),
    invoice_no: trimField(header.invoiceNo),
    qty_received: qtyReceived,
    bora_carton_unit: boraCartonUnit,
    location_rack: trimField(header.location),
    received_by: trimField(header.receivedBy),
    remark: trimField(header.remark),
    grn_entry_detail: serializeGrnDetail(state),
    ...(sizeBreakdown ? { size_breakdown: sizeBreakdown } : {}),
    created_by: sessionUserId ?? null
  };
}

export function sanitizeGrnSizeInput(value) {
  return String(value ?? "").replace(/[^0-9]/g, "");
}

export function sanitizeGrnFabricInput(field, value) {
  let next = String(value ?? "");
  if (field === "gsm" || field === "rolls") next = next.replace(/[^0-9]/g, "");
  if (field === "kgs") next = next.replace(/[^0-9.]/g, "");
  return next;
}
