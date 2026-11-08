// Native exports retain exact decimal strings and use RFC-4180 escaping. The
// legacy exporter remains compatible with the historical Scott output.
export function dashboardCsvCell(value, numeric = false) {
  let text = value == null ? "" : String(value);
  if (!numeric && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function buildDashboardCsv(columns, rows, includeHeader = true) {
  return [
    ...(includeHeader
      ? [columns.map((c) => dashboardCsvCell(c.label ?? c.header)).join(",")]
      : []),
    ...rows.map((row) =>
      columns
        .map((column) => {
          const key = column.keys?.[0] ?? column.key;
          return dashboardCsvCell(
            row[key],
            ["number", "currency", "percent", "decimal"].includes(
              column.format ?? column.type,
            ),
          );
        })
        .join(","),
    ),
  ].join("\r\n");
}

// Exports retain the registry header contract even where the table hides columns.
export function dashboardExportColumns(columns, headers) {
  const extra = {
    "Order ID": { key: "order_id" },
    "Order Number": { key: "order_number" },
    "Customer Code": { key: "customer_code" },
    Customer: { key: "customer_name" },
    "Customer Type": { key: "customer_type" },
    Date: { key: "order_date" },
    Qty: { key: "total_qty", format: "number" },
    Amount: { key: "total_amount", format: "currency" },
    Status: { key: "status" },
  };
  return (headers ?? columns.map((c) => c.label)).map((label) => {
    const column = columns.find((c) => c.label === label) ?? extra[label];
    if (!column)
      throw new Error(`No native export field is defined for ${label}.`);
    return { ...column, label };
  });
}
