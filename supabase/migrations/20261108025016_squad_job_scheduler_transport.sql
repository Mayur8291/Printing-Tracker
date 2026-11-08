BEGIN;
-- Hosted Supabase supplies pg_net. The isolated vanilla-Postgres test harness
-- lacks the extension; install_jobs.py separately requires and tests it live.
DO $f$ BEGIN
 IF EXISTS(SELECT FROM pg_available_extensions WHERE name='pg_net') THEN
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC,anon,authenticated,sa_app;
 END IF;
END $f$;
COMMIT;
