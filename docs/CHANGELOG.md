# Changelog

## 2026-06-22 — GRN inward full-page entry

- **Feature:** Dispatch > Inward GRN entry now opens as full-page view (`InwardGrnEntryPage`) instead of modal.
- **Database:** Added `inward_grn_entries.grn_entry_detail` jsonb column (migration `20260630120000_add_grn_entry_detail.sql`) for apparel bora lines and fabric receipt lines.
- **Files:** `src/inwardGrnFormUtils.js`, `src/InwardGrnEntryPage.jsx`, `src/DispatchTabPanel.jsx`, `src/inwardEntryUtils.js`, `src/styles.css`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md.
