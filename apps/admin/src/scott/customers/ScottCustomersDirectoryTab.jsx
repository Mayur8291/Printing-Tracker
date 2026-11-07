// Scott CUSTOMERS → Directory sub-tab.
//
// `useScottList` + `ScottListPage` over the bespoke customers service, plus create / edit /
// delete through `ScottEntityDialog`.
//
// ---------------------------------------------------------------------------
// SERVER vs CLIENT SPLIT (the hybrid contract)
// ---------------------------------------------------------------------------
// `GET customers` understands exactly TWO query params this screen can trust: `search` and
// `zone_id` (`buildCustomerListQuery` in customersService.js). Those live HERE, as panel
// state fed straight into `fetchCustomersPaginated` / `fetchCustomers`.
//
// STATUS AND TYPE ARE NOT AMONG THEM. Scott has no `status` column (it is derived from
// `approved`/`onboarded`, `readCustomerStatus`) and usually sends no `customer_type` (it is
// inferred from the RMP price-type name, `readCustomerType`). Wiring those chips to server
// params made them silently inert — the chip said "Distributor", the grid kept every row.
// They are now ordinary CLIENT quick filters on `useScottList`, evaluated by the shared
// engine over exactly the normalized values the table renders, which is what the ORIGINAL
// did (`ScottOne/src/pages/Customers.tsx` only ever sent `search`).
//
// Everything else — the advanced filter builder and every column sort — is client-side and
// is what flips `useScottList` into 'full' mode (drain 500 x 40, then filter/sort/paginate
// in memory). `config.toFilterRow` flattens `addresses[0]` onto the row first, which is the
// only reason an Address / City / State / Postal Code filter can match at all.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { createCSVContent, downloadCsv } from "@/scott/bulk/csvImportService";
import { resetCustomerPerformanceEnrichmentCache } from "@/scott/data/customerPerformanceService";
import {
  OWNER_DISTRIBUTOR_TYPE_WARNING,
  buildCustomerFields,
  customerFormToCustomerData,
  customerToFormValues,
  customersConfig,
  validateCustomerForm
} from "@/scott/data/customersConfig";
import {
  createCustomer,
  deleteCustomer,
  fetchCustomers,
  fetchCustomersPaginated,
  getCustomerByCode,
  getCustomerById,
  updateCustomer
} from "@/scott/data/customersService";
import { fetchAllScottPages } from "@/scott/scottPagination";
import {
  preferredPriceTypeNameForCustomerType,
  resolveCustomerDisplayType,
  resolveDefaultRmpPriceTypeId,
  resolveRmpPriceTypeIdFromCustomer,
  resolveZoneDisplayLabel
} from "@/scott/data/customerTypes";
import { QUICK_FILTER_ALL_VALUE, setQuickEnumFilter } from "@/scott/list/quickFilters";
import { useScottList } from "@/scott/list/useScottList";
import ScottEntityDialog from "@/scott/ui/ScottEntityDialog";
import ScottListPage from "@/scott/ui/ScottListPage";
import { readScottCellValue } from "@/scott/ui/ScottTable";
import {
  ALL_OPTION_VALUE,
  buildCitySuggestions,
  buildPriceTypeOptions,
  buildStateOptions,
  buildZoneOptionsFromCustomers,
  loadRmpPriceTypes
} from "@/scott/customers/customerOptionSources";
import { learnLocationIds } from "@/scott/customers/customerLocationCatalogue";

// ---------------------------------------------------------------------------
// Columns — the config's 19, with the two display resolvers layered on
// ---------------------------------------------------------------------------
//
// `resolveCustomerDisplayType` IS the house rule for "customer type" (RMP price-type name
// first, then customer_type_name, then customer_type with numeric ids dropped), and
// `resolveZoneDisplayLabel` is its zone counterpart. Both are applied as a `format`
// FALLBACK: the raw column value still wins, so a row that already carries the flat field
// renders identically to before.

const DIRECTORY_COLUMNS = Object.freeze(
  customersConfig.columns.map((column) => {
    if (column.key === "rmp_price_type_name") {
      return {
        ...column,
        format: (raw, row) => raw || resolveCustomerDisplayType([row], row) || ""
      };
    }
    if (column.key === "zone_name") {
      return {
        ...column,
        format: (raw, row) => raw || resolveZoneDisplayLabel([row], row) || ""
      };
    }
    return column;
  })
);

/** The shared customers config with the resolver-aware columns swapped in. */
export const customersDirectoryConfig = Object.freeze({
  ...customersConfig,
  columns: DIRECTORY_COLUMNS
});

/**
 * The cycling chips. Every `value` is byte-identical to what `normalizeCustomer` writes on
 * the row, because `filterEngine.testEnumCondition` compares with `String(a) === String(b)`
 * and does not normalize case.
 *
 * Approved / Onboarded are here too: the config has always DECLARED them
 * (`CUSTOMERS_QUICK_FILTERS`) and this tab used to drop them by overriding the prop, leaving
 * "approved but not onboarded" — a real, actionable state — reachable only through the
 * advanced panel.
 */
const QUICK_FILTER_CHIPS = Object.freeze([
  {
    key: "status",
    label: "Status",
    options: [
      { value: QUICK_FILTER_ALL_VALUE, label: "All" },
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" }
    ]
  },
  {
    key: "customer_type",
    label: "Type",
    options: [
      { value: QUICK_FILTER_ALL_VALUE, label: "All" },
      { value: "retail", label: "Retail" },
      { value: "distributor", label: "Distributor" }
    ]
  },
  {
    key: "approved",
    label: "Approved",
    options: [
      { value: QUICK_FILTER_ALL_VALUE, label: "All" },
      { value: "Yes", label: "Yes" },
      { value: "No", label: "No" }
    ]
  },
  {
    key: "onboarded",
    label: "Onboarded",
    options: [
      { value: QUICK_FILTER_ALL_VALUE, label: "All" },
      { value: "Yes", label: "Yes" },
      { value: "No", label: "No" }
    ]
  }
]);

/** `YYYY-MM-DD` for the export filename (spec §8: `customers-YYYY-MM-DD.csv`). */
function exportDateStamp(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Plain-text value for one column, mirroring what the table renders. */
function csvCell(column, row) {
  const raw = readScottCellValue(row, column.key);
  const value = typeof column.format === "function" ? column.format(raw, row) : raw;
  if (value === null || value === undefined || value === "") return "";
  // Spec §8: the CSV renders Last Order Date through `toLocaleDateString('en-IN')`.
  if (column.type === "date") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-IN");
  }
  return String(value);
}

/**
 * The rows a CSV export must cover — NEVER just the visible page.
 *
 * This is `resolveMasterListExportRows` (spec §8, `ScottOne/src/utils/exportUtils.ts`), which
 * has no "current page" branch at all:
 *
 *   full mode (any filter OR sort)  the in-memory filtered + sorted set;
 *   server mode + a search term     every page of THAT search (100 at a time);
 *   server mode, no search          the whole customer base (500 x 40).
 *
 * The old `list.rows` fallback silently shipped one page of up to 20,000 customers and
 * reported the truncated count to the user as a success.
 *
 * @param {{mode?: string, processedRows?: object[], search?: string, serverFilters?: object}} args
 * @param {{fetchPage?: Function, fetchAll?: Function, fetchAllPages?: Function}} [deps]
 * @returns {Promise<object[]>}
 */
export async function resolveCustomerExportRows(
  { mode, processedRows = [], search = "", serverFilters = {} } = {},
  deps = {}
) {
  const page = deps.fetchPage ?? fetchCustomersPaginated;
  const all = deps.fetchAll ?? fetchCustomers;
  const drain = deps.fetchAllPages ?? fetchAllScottPages;

  if (mode === "full") return processedRows;

  const term = String(search ?? "").trim();
  if (term) {
    return drain(
      (pageParams) =>
        page({ page: pageParams.page, items: pageParams.items, search: term }, serverFilters),
      { pageSize: 100 }
    );
  }

  return all(serverFilters);
}

/**
 * Re-read the full record behind a list row before opening the edit dialog.
 *
 * `GET customers/{id}` is the normal path. A row that carries only its CODE — Scott's own
 * `customer_id` is the code (`P-1598`), and a row synthesised from a report or an import
 * preview may have nothing else — resolves through `GET customers/by_code?customer_code=…`
 * instead, which is the customer-lookup-by-code operation the spec lists (customers.md §4,
 * S4.1). Sending a code to the by-id endpoint would 404.
 *
 * @param {Record<string, unknown>} row
 * @returns {Promise<object>} the full customer
 */
export async function readCustomerForEdit(row, deps = {}) {
  const byId = deps.getById ?? getCustomerById;
  const byCode = deps.getByCode ?? getCustomerByCode;

  const id = String(row?.id ?? "").trim();
  if (id) return byId(id);

  const code = String(row?.customer_code ?? row?.customer_id ?? "").trim();
  if (!code) throw new Error("Customer not found");

  const customer = await byCode(code);
  if (!customer) throw new Error(`No customer found for code ${code}`);
  return customer;
}

/**
 * The price type to save.
 *
 * The original re-resolved the default price type live, the moment the customer type
 * changed. `ScottEntityDialog` owns its form state and exposes no change hook, so the same
 * rule is applied at submit instead — with the seeded values as the reference point:
 *
 *   - a value different from the one we seeded is an EXPLICIT user choice → never touched;
 *   - customer type unchanged → leave the field exactly as it is;
 *   - customer type changed with no explicit pick → re-resolve the zone-scoped default.
 */
export function resolvePriceTypeOnSubmit(values, session) {
  const chosen = String(values?.price_type_id ?? "").trim();
  const seeded = String(session?.seed?.price_type_id ?? "").trim();
  const seededType = session?.seed?.customer_type === "distributor" ? "distributor" : "retail";
  const nextType = values?.customer_type === "distributor" ? "distributor" : "retail";

  if (chosen && chosen !== seeded) return chosen;
  if (nextType === seededType) return chosen;

  return (
    resolveDefaultRmpPriceTypeId(
      session?.priceTypes,
      preferredPriceTypeNameForCustomerType(nextType),
      session?.customer?.zone_id
    ) ?? chosen
  );
}

/**
 * Customers directory.
 *
 * @param {object} props
 * @param {boolean} [props.mayEdit=false] gates create / edit / delete.
 * @param {(message: unknown) => void} [props.toast]
 * @param {(message: unknown) => void} [props.toastError]
 */
export default function ScottCustomersDirectoryTab({ mayEdit = false, toast, toastError }) {
  // `zone_id` is the ONE list filter besides `search` that Scott actually has a column for.
  // Status and Type are client-side quick filters on the hook — see the header note.
  const [zoneFilter, setZoneFilter] = useState("");

  const [dialog, setDialog] = useState(null);
  const [opening, setOpening] = useState(false);
  // Set by the first submit that would move an owner distributor off `distributor`; the
  // second submit is the confirmation.
  const ownerWarningAckRef = useRef(false);

  const serverFilters = useMemo(() => {
    const filters = {};
    if (zoneFilter) filters.zone_id = zoneFilter;
    return filters;
  }, [zoneFilter]);

  // Re-created every render on purpose: `useScottList` keeps both callbacks in a ref that it
  // refreshes before its fetch effects run, so each fetch always sees the current filters.
  const fetchPage = useCallback(
    ({ page, items, search }) => fetchCustomersPaginated({ page, items, search }, serverFilters),
    [serverFilters]
  );
  const fetchAll = useCallback(() => fetchCustomers(serverFilters), [serverFilters]);

  const list = useScottList({ config: customersDirectoryConfig, fetchPage, fetchAll });

  // A server-filter change is invisible to the hook's fetch effects (their deps are page /
  // pageSize / search / reloadToken), so nudge both: page 1 + a refresh that also drops the
  // drained 'full'-mode dataset.
  const { setPage, refresh } = list;
  const firstFilterRun = useRef(true);
  useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false;
      return;
    }
    setPage(1);
    refresh();
  }, [serverFilters, setPage, refresh]);

  // Zone options are derived from whatever customers are already loaded — the drained set
  // once 'full' mode has run, otherwise the current page. (State/city no longer are: the
  // dialog's State list is the static all-India one and City is free text, because deriving
  // them from the loaded page made most of the country un-enterable — see
  // customerLocationCatalogue.js.)
  const optionSourceRows = list.allRows.length > 0 ? list.allRows : list.rows;
  const zoneOptions = useMemo(
    () => buildZoneOptionsFromCustomers(optionSourceRows),
    [optionSourceRows]
  );

  // Harvest real `state_id` / `city_id` values off whatever arrived. Only nested address
  // objects carry them (the flat production row hardcodes both to `''`), so this is usually
  // a no-op — but every pair it does find is one more address that round-trips correctly,
  // and the catalogue is persisted across sessions.
  useEffect(() => {
    learnLocationIds(optionSourceRows);
  }, [optionSourceRows]);

  const priceTypesRef = useRef(null);

  const ensurePriceTypes = useCallback(async () => {
    if (!priceTypesRef.current) {
      priceTypesRef.current = loadRmpPriceTypes().catch((error) => {
        priceTypesRef.current = null; // never cache a rejection
        throw error;
      });
    }
    return priceTypesRef.current;
  }, []);

  /**
   * Build one dialog session: field list, seed values and the record being edited.
   *
   * STATE is a select over every Indian state (plus anything Scott has shown us); CITY is
   * free text with the known cities of the seeded state offered as a hint. Both carry
   * NAMES — `customerLocationCatalogue` turns them into upstream ids at submit time, or
   * omits the FK. See that module for why no real master is reachable from this repo.
   */
  const buildSession = useCallback(
    (customer, priceTypes, rows) => {
      const priceTypeOptions = buildPriceTypeOptions(priceTypes);
      const sourceRows = customer ? [...rows, customer] : rows;
      // Every read is a chance to learn a real `name -> id` pair off a nested address.
      learnLocationIds(sourceRows);
      const stateOptions = buildStateOptions(sourceRows);

      if (!customer) {
        const seed = {
          customer_type: "retail",
          price_type_id:
            resolveDefaultRmpPriceTypeId(
              priceTypes,
              preferredPriceTypeNameForCustomerType("retail")
            ) ?? "",
          status: "active"
        };
        return {
          customer: null,
          priceTypes,
          seed,
          record: seed,
          fields: buildCustomerFields({
            isEdit: false,
            priceTypeOptions,
            stateOptions,
            cityOptions: buildCitySuggestions(sourceRows)
          })
        };
      }

      const values = customerToFormValues(customer);
      // An explicit `price_type_id` wins; otherwise recover it from the echoed
      // `rmp_price_type_name` + the customer's zone.
      values.price_type_id = resolveRmpPriceTypeIdFromCustomer(customer, priceTypes) || "";

      return {
        customer,
        priceTypes,
        seed: values,
        record: { id: customer.id, ...values },
        fields: buildCustomerFields({
          isEdit: true,
          priceTypeOptions,
          stateOptions,
          // Suggestions only — `city_name` is a text input, so an unlisted city is still
          // typed straight in and nothing is ever disabled.
          cityOptions: buildCitySuggestions(sourceRows, values.state_name),
          isOwnerDistributor: Boolean(customer.is_owner_distributor)
        })
      };
    },
    []
  );

  const openDialog = useCallback(
    async (row) => {
      if (opening) return;
      setOpening(true);
      try {
        let priceTypes = [];
        try {
          priceTypes = await ensurePriceTypes();
        } catch (error) {
          toastError?.(error); // an empty price-type list must not block the form
        }

        // List rows are the flat shape and carry no nested address ids; the update /
        // destroy address endpoints need them, so edits always re-read the full record.
        const customer = row ? await readCustomerForEdit(row) : null;
        ownerWarningAckRef.current = false;
        setDialog(buildSession(customer, priceTypes, optionSourceRows));
      } catch (error) {
        toastError?.(error);
      } finally {
        setOpening(false);
      }
    },
    [opening, ensurePriceTypes, buildSession, optionSourceRows, toastError]
  );

  const handleSubmit = useCallback(
    async (values) => {
      // The config's own validators, in field order — first failure wins and lands in the
      // dialog's single form-level Alert.
      const problem = validateCustomerForm(values);
      if (problem) throw new Error(problem);

      // OWNER / DIRECT-DEAL DISTRIBUTOR GUARD (ScottOne CustomerDialogNew.tsx:83-87,367-375).
      // Upstream showed a passive destructive Alert. `ScottEntityDialog` owns its form state
      // and exposes no live change hook, and it belongs to another worker, so the same
      // warning is delivered through the dialog's ONE form-level Alert as an explicit
      // confirm: the first submit stops and explains, the second goes through. The field's
      // own `hint` carries the notice the whole time the dialog is open.
      if (
        dialog?.customer?.is_owner_distributor &&
        dialog?.seed?.customer_type === "distributor" &&
        values?.customer_type !== "distributor" &&
        !ownerWarningAckRef.current
      ) {
        ownerWarningAckRef.current = true;
        throw new Error(`${OWNER_DISTRIBUTOR_TYPE_WARNING} Press Save again to confirm.`);
      }

      const form = { ...values, price_type_id: resolvePriceTypeOnSubmit(values, dialog) };
      const data = customerFormToCustomerData(form, dialog?.customer);

      try {
        if (dialog?.customer?.id) {
          // `updateCustomer` is read-merge-write and reconciles the address collection via
          // syncCustomerAddresses → updateCustomerAddress / destroyCustomerAddress.
          await updateCustomer({
            id: dialog.customer.id,
            updates: data,
            previousAddresses: dialog.customer.addresses
          });
          toast?.(`Updated ${data.company_name} · ${data.customer_code}`);
        } else {
          const created = await createCustomer(data);
          toast?.(
            `Added customer ${created?.company_name || data.company_name} · ${created?.customer_code || data.customer_code}`
          );
        }
      } catch (error) {
        toastError?.(error);
        throw error; // keeps the dialog open with the inline Alert
      }

      resetCustomerPerformanceEnrichmentCache();
      refresh();
    },
    [dialog, toast, toastError, refresh]
  );

  const handleDelete = useCallback(
    async (row) => {
      try {
        // Guards the owner distributor client-side and throws
        // OWNER_DISTRIBUTOR_DELETE_MESSAGE when it would be removed.
        await deleteCustomer(row?.id);
        toast?.(`Deleted ${row?.company_name || row?.customer_code || row?.id}`);
        resetCustomerPerformanceEnrichmentCache();
        refresh();
      } catch (error) {
        toastError?.(error);
      }
    },
    [toast, toastError, refresh]
  );

  const handleExport = useCallback(async () => {
    try {
      const rows = await resolveCustomerExportRows({
        mode: list.mode,
        processedRows: list.processedRows,
        search: list.debouncedSearch,
        serverFilters
      });
      if (rows.length === 0) {
        toast?.("Nothing to export.");
        return;
      }
      const content = createCSVContent(
        DIRECTORY_COLUMNS.map((column) => column.header),
        rows.map((row) => DIRECTORY_COLUMNS.map((column) => csvCell(column, row)))
      );
      downloadCsv(`customers-${exportDateStamp()}.csv`, content);
      toast?.(`Exported ${rows.length.toLocaleString("en-IN")} customers.`);
    } catch (error) {
      toastError?.(error);
    }
  }, [
    list.mode,
    list.processedRows,
    list.debouncedSearch,
    serverFilters,
    toast,
    toastError
  ]);

  // CLIENT-SIDE chips. `list.quickFilters` is the hook's own quick-filter state, so the
  // engine evaluates them over the same normalized rows the grid renders — `status` as
  // derived by `readCustomerStatus`, `customer_type` as inferred by `readCustomerType`.
  // Turning either on flips the list into 'full' mode, which is the price of a filter that
  // is honest about what it matched.
  const { quickFilters: quickFilterValues, setQuickFilters } = list;

  const quickFilters = useMemo(
    () =>
      QUICK_FILTER_CHIPS.map((chip) => ({
        ...chip,
        value: quickFilterValues?.[chip.key] || QUICK_FILTER_ALL_VALUE
      })),
    [quickFilterValues]
  );

  const handleQuickFilterChange = useCallback(
    (key, value) => {
      setQuickFilters((prev) => setQuickEnumFilter(prev, key, value));
    },
    [setQuickFilters]
  );

  const toolbarActions =
    zoneOptions.length > 0 ? (
      <Select
        value={zoneFilter || ALL_OPTION_VALUE}
        onValueChange={(value) => setZoneFilter(value === ALL_OPTION_VALUE ? "" : value)}
        disabled={list.loading}
      >
        <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Filter by zone">
          <SelectValue placeholder="All zones" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_OPTION_VALUE}>All zones</SelectItem>
          {zoneOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null;

  return (
    <>
      <ScottListPage
        config={customersDirectoryConfig}
        list={list}
        title="Customer directory"
        subtitle="Every Scott customer, with types, zones, addresses and onboarding state."
        mayEdit={mayEdit}
        onCreate={mayEdit ? () => openDialog(null) : undefined}
        onEdit={(row) => openDialog(row)}
        onDelete={mayEdit ? handleDelete : undefined}
        onExport={handleExport}
        onQuickFilterChange={handleQuickFilterChange}
        quickFilters={quickFilters}
        toolbarActions={toolbarActions}
        searchPlaceholder="Search code, company, contact, email…"
        emptyMessage="No customers match these filters."
      />

      {dialog ? (
        <ScottEntityDialog
          key={dialog.customer?.id ? `edit-${dialog.customer.id}` : "create"}
          open
          config={customersDirectoryConfig}
          fields={dialog.fields}
          record={dialog.record}
          description={
            dialog.customer?.is_owner_distributor ? OWNER_DISTRIBUTOR_TYPE_WARNING : undefined
          }
          readOnly={!mayEdit}
          onSubmit={handleSubmit}
          onClose={() => setDialog(null)}
          idPrefix="scott-customer"
        />
      ) : null}
    </>
  );
}
