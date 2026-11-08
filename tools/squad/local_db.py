"""Isolated PostgreSQL harness: source schema plus synthetic identities, never customer dumps."""
import argparse,json,os,subprocess,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
PRIVATE=HERE/'private'
PG=Path('/opt/homebrew/opt/postgresql@17/bin')
PORT=55441
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
import psycopg
from psycopg.types.json import Jsonb
from snapshot import read_schema,render_schema

def connect():return psycopg.connect(host='127.0.0.1',port=PORT,user='postgres',dbname='squad_test',autocommit=True)
def start():
 PRIVATE.mkdir(exist_ok=True,mode=0o700)
 data=PRIVATE/'pgdata'
 if not data.exists():
  subprocess.run([str(PG/'initdb'),'-D',str(data),'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale'],check=True,capture_output=True)
 if subprocess.run([str(PG/'pg_ctl'),'-D',str(data),'status'],capture_output=True).returncode:
  subprocess.run([str(PG/'pg_ctl'),'-D',str(data),'-l',str(PRIVATE/'postgres.log'),'-o',f'-p {PORT} -h 127.0.0.1 -k {PRIVATE}','-w','start'],check=True,capture_output=True)
 with psycopg.connect(host='127.0.0.1',port=PORT,user='postgres',dbname='postgres',autocommit=True) as c:
  if not c.execute("SELECT 1 FROM pg_database WHERE datname='squad_test'").fetchone():c.execute('CREATE DATABASE squad_test')

def bootstrap():
 start()
 with connect() as c:
  if c.execute("SELECT to_regclass('sa_snapshot_20261019.sa_users')").fetchone()[0]:
   print('Synthetic database already initialized');return
  c.execute("""
  DO $f$ DECLARE r text; BEGIN
   FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','authenticator','supabase_auth_admin'] LOOP
    IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN',r); END IF;
   END LOOP;
  END $f$;
  ALTER ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth; CREATE SCHEMA sa_admin; CREATE SCHEMA sa_sync; CREATE SCHEMA canto_api;
  CREATE TABLE auth.users(id uuid PRIMARY KEY,role text,email text,encrypted_password text,banned_until timestamptz,
    raw_app_meta_data jsonb DEFAULT '{}',raw_user_meta_data jsonb DEFAULT '{}',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
  CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),not_after timestamptz);
  CREATE TABLE auth.refresh_tokens(id bigint GENERATED ALWAYS AS IDENTITY,user_id text,session_id uuid REFERENCES auth.sessions ON DELETE CASCADE);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $f$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $f$;
  GRANT USAGE ON SCHEMA auth TO PUBLIC;
  CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
  CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users,role text);
  CREATE TABLE public.admin_emails(email text PRIMARY KEY);
  CREATE TABLE sa_sync.environment_state(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    environment text NOT NULL DEFAULT 'staging',edit_revision bigint NOT NULL DEFAULT 0,synced_revision bigint NOT NULL DEFAULT 0,
    cutover boolean NOT NULL DEFAULT false,active_job uuid,updated_at timestamptz DEFAULT now());
  INSERT INTO sa_sync.environment_state(singleton) VALUES(true);
  ALTER TABLE sa_sync.environment_state ENABLE ROW LEVEL SECURITY;
  CREATE SCHEMA sa_snapshot_20261019;
  CREATE SCHEMA sa_media;
  CREATE TABLE sa_admin.media(resource text,record_id bigint,field text,url text,PRIMARY KEY(resource,record_id,field));
  ALTER TABLE sa_admin.media ENABLE ROW LEVEL SECURITY;
  CREATE TABLE sa_media.objects(sha256 text PRIMARY KEY,object_path text UNIQUE NOT NULL,bytes bigint NOT NULL,content_type text NOT NULL,verified_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE sa_media.objects ENABLE ROW LEVEL SECURITY;
  CREATE TABLE sa_media.references(resource text,record_id bigint,field text,pointer text DEFAULT '',source_value text,source_url text,status text,sha256 text,
    PRIMARY KEY(resource,record_id,field,pointer));
  ALTER TABLE sa_media.references ENABLE ROW LEVEL SECURITY;
  """)
  model,_=read_schema(ROOT/'tools/canto-sync/tests/fixtures/staging-schema.sql','staging')
  with c.transaction():
   for statement in render_schema(model,'sa_snapshot_20261019'):c.execute(statement)
   for table in model.tables:
    c.execute(psycopg.sql.SQL('ALTER TABLE sa_snapshot_20261019.{} ENABLE ROW LEVEL SECURITY').format(psycopg.sql.Identifier('sa_'+table)))
   c.execute((ROOT/'tools/canto-sync/supabase/migrations/20261107035249_canto_auth_sync.sql').read_text())
   c.execute("""CREATE FUNCTION sa_admin.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
    SELECT auth.uid() IS NOT NULL AND auth.jwt()->>'role'='authenticated'
      AND EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=auth.uid() AND p.role='admin'
        AND u.role='authenticated' AND (u.banned_until IS NULL OR u.banned_until<now()))
      AND EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id::text=auth.jwt()->>'session_id' AND s.user_id=auth.uid()
        AND (s.not_after IS NULL OR s.not_after>now())); $f$;
    REVOKE ALL ON FUNCTION sa_admin.is_admin() FROM PUBLIC;
   """)
  # Install the actual existing Masters dispatcher for atomic file-save tests.
  # Minimal Storage catalog fixtures only; no Storage HTTP server is emulated.
  c.execute("CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(id uuid,bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS 'SELECT string_to_array($1,''/'')';GRANT USAGE ON SCHEMA storage TO authenticated;")
  c.execute((ROOT/'supabase/migrations/20261107045242_canto_admin_masters.sql').read_text())
  from pglast import parse_sql,ast
  from pglast.stream import RawStream
  for item in parse_sql((ROOT/'supabase/migrations/20261107064651_canto_media_sync.sql').read_text()):
   if isinstance(item.stmt,ast.CreateFunctionStmt) and [x.sval for x in item.stmt.funcname]==['sa_admin','read_record']:c.execute(RawStream()(item.stmt))
  print('Initialized 86 source tables and isolated Auth/session fixtures')

def rebuild():
 start()
 # This connection is hard-coded to the synthetic localhost cluster, never Supabase.
 with psycopg.connect(host='127.0.0.1',port=PORT,user='postgres',dbname='postgres',autocommit=True) as c:
  c.execute('DROP DATABASE squad_test WITH (FORCE)')
  c.execute('CREATE DATABASE squad_test')
 bootstrap()
 with connect() as c:
  for path in sorted((ROOT/'supabase/migrations').glob('*_squad_*.sql')):
   c.execute(path.read_text());print('Applied',path.name)

def main():
 parser=argparse.ArgumentParser();parser.add_argument('action',choices=['start','bootstrap','rebuild','status']);a=parser.parse_args()
 if a.action=='start':start();print('Local synthetic database started')
 elif a.action=='bootstrap':bootstrap()
 elif a.action=='rebuild':rebuild()
 else:
  with connect() as c:print(json.dumps({'database':c.execute('SELECT current_database()').fetchone()[0]}))
if __name__=='__main__':main()
