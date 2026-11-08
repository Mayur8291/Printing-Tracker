-- Explicit production-only compatibility for the unchanged reviewed Squad chain.
-- Existing source columns/values remain untouched. These match staging exactly.
-- The old production provider is Uniware, hence its original source default.
ALTER TABLE sa_snapshot_20261019.sa_orders ADD COLUMN dashboard_reservation_id varchar;
ALTER TABLE sa_snapshot_20261019.sa_orders ADD COLUMN order_source varchar NOT NULL DEFAULT 'unicommerce';
