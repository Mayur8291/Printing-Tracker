-- Align private identity validation and imported sequence owner permissions.
-- Business/Auth rows, API grants and public schema remain unchanged.
BEGIN;
DO $parity$
DECLARE r record;
BEGIN
 IF NOT EXISTS(SELECT FROM sa_sync.environment_state WHERE singleton AND NOT cutover AND active_job IS NULL)
 OR EXISTS(SELECT FROM sa_domain.runtime_state WHERE allow_test_writes OR cardinality(test_actor_ids)>0 OR test_write_expires_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Parity alignment requires an idle mirror without rehearsals'; END IF;
 ALTER TABLE sa_identity.sa_auth_identities ALTER COLUMN reserved_at SET DEFAULT now();
 IF EXISTS(SELECT FROM pg_constraint WHERE conrelid='sa_identity.sa_auth_identities'::regclass AND conname='sa_auth_identities_legacy_user_id_key') THEN
  ALTER TABLE sa_identity.sa_auth_identities RENAME CONSTRAINT sa_auth_identities_legacy_user_id_key TO sa_auth_identities_legacy_user_key;
 END IF;
 IF EXISTS(SELECT FROM pg_constraint WHERE conrelid='sa_identity.sa_auth_identities'::regclass AND conname='sa_auth_identities_legacy_user_id_fkey') THEN
  ALTER TABLE sa_identity.sa_auth_identities DROP CONSTRAINT sa_auth_identities_legacy_user_id_fkey;
 END IF;
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='sa_identity.sa_auth_identities'::regclass AND conname='sa_auth_identities_legacy_user_fkey') THEN
  ALTER TABLE sa_identity.sa_auth_identities ADD CONSTRAINT sa_auth_identities_legacy_user_fkey FOREIGN KEY(legacy_user_id) REFERENCES sa_sync.legacy_identity_keys(legacy_user_id) ON DELETE RESTRICT;
 END IF;
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='sa_identity.sa_auth_identities'::regclass AND conname='sa_auth_identities_state_check') THEN
  ALTER TABLE sa_identity.sa_auth_identities ADD CONSTRAINT sa_auth_identities_state_check CHECK(enrollment_state IN('pending','ready','blocked'));
 END IF;
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='sa_identity.sa_auth_identities'::regclass AND conname='sa_auth_identities_confirmation_check') THEN
  ALTER TABLE sa_identity.sa_auth_identities ADD CONSTRAINT sa_auth_identities_confirmation_check CHECK(confirmation_basis IN('source_confirmed','owner_approved_grandfather','not_activated'));
 END IF;
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='sa_identity.sa_auth_identities'::regclass AND conname='sa_auth_identities_disposition_check') THEN
  ALTER TABLE sa_identity.sa_auth_identities ADD CONSTRAINT sa_auth_identities_disposition_check CHECK(import_disposition IN('candidate','inactive','identity_exception'));
 END IF;
 CREATE INDEX IF NOT EXISTS sa_auth_identities_canonical_email_idx ON sa_identity.sa_auth_identities(canonical_email);
 FOR r IN SELECT unnest(ARRAY['sa_add_on_base_products_id_seq','sa_add_on_parts_id_seq','sa_add_ons_id_seq','sa_app_configs_id_seq','sa_asset_infos_id_seq','sa_authorized_brands_id_seq','sa_base_product_asset_infos_id_seq','sa_base_product_categories_id_seq','sa_base_product_fabrics_id_seq','sa_base_product_parts_id_seq','sa_base_product_types_id_seq','sa_base_products_id_seq','sa_base_size_types_id_seq','sa_bulk_uploads_id_seq','sa_catalogues_id_seq','sa_categories_id_seq','sa_fabrics_id_seq','sa_parts_id_seq','sa_profit_margins_id_seq','sa_promotional_banners_id_seq','sa_promotions_id_seq','sa_reset_password_histories_id_seq','sa_rmp_brands_id_seq','sa_rmp_categories_id_seq','sa_rmp_category_brands_id_seq','sa_rmp_classes_id_seq','sa_rmp_colors_id_seq','sa_rmp_min_infos_id_seq','sa_rmp_price_types_id_seq','sa_rmp_prices_id_seq','sa_rmp_sizes_id_seq','sa_rmp_sku_prices_id_seq','sa_rmp_skus_id_seq','sa_sc_sizes_id_seq','sa_settings_id_seq','sa_size_types_id_seq','sa_stock_infos_id_seq','sa_sync_airtables_id_seq','sa_user_devices_id_seq']) AS sequence_name LOOP
  IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sa_snapshot_20261019' AND c.relname=r.sequence_name AND c.relkind='S' AND pg_get_userbyid(c.relowner)='postgres') THEN RAISE EXCEPTION 'Unexpected sequence owner';END IF;
  EXECUTE format('GRANT ALL ON SEQUENCE sa_snapshot_20261019.%I TO postgres',r.sequence_name);
 END LOOP;
END $parity$;
COMMIT;
