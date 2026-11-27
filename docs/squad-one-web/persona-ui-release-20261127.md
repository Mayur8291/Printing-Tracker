# Persona UI review release — 27 November 2026

The existing Flutter-matched local persona UI is merged onto Vercel release commit `1d51377e508483921e84106ec1dc12079e4a708a`, retaining newer Tracker and catalogue changes.

Persona navigation is enabled by default. `?persona=1` explicitly enables it in a browser; `?persona=0` retains the legacy layout for comparison. This release includes the existing local persona navigation map, icons, bottom bar, right menu, customer/coordinator screens, factory screens, order boards, counters and shared client support.

Validation: locked web dependency install; production build; 94 existing UI/client tests; local Chrome render/navigation checks for all 11 login personas with synthetic empty data. The two statistics RPCs exist in both staging and production. The browser fixtures verify rendering and navigation, not real-account business workflows or complete Flutter parity acceptance. Existing capability restrictions remain, including the Production Coordinator customer-tab restriction.

The production login default and tab-scoped environment switch are retained. No database migration, backend deployment, native-app release or business-data write is part of this web release. Existing newer product-studio files take precedence where they overlap older local copies.
