// One-time dependency injection for the Reports section.
//
// `rmpSalesService.js` deliberately does NOT import the customers service: it was written
// before `src/scott/data/customersService.js` existed and exposes
// `configureRmpCustomerLoader(loader)` so the composition root supplies it instead. This
// module IS that composition root — the Reports panel imports it, and nothing in
// `src/scott/data/**` has to change.
//
// The loader is only ever CALLED when an RMP Sales overview drain finds rows that carry a
// `customer_id` but no `customer_code`; registering it here costs nothing until then.

import { fetchCustomers } from "@/scott/data/customersService";
import { configureRmpCustomerLoader } from "@/scott/data/reports/rmpSalesService";

let installed = false;

/**
 * Register the customers-master loader with `rmpSalesService`.
 * Idempotent: `configureRmpCustomerLoader` resets the service's customer cache on every
 * call, so re-registering on each panel mount would throw away a warm cache.
 */
export function installScottReportsBootstrap() {
  if (installed) return;
  installed = true;
  // `fetchCustomers()` is the customers-master fetch-all (500 rows x 40 pages).
  configureRmpCustomerLoader(() => fetchCustomers());
}

export default installScottReportsBootstrap;
