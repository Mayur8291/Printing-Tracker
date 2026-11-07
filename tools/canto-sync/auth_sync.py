"""Source-authoritative Canto Auth enrollment, inside the snapshot publication transaction.

Uses standard auth.users + email identities, retaining bcrypt hashes, reserved UUIDs,
and current Rails eligibility. Does not import Rails sessions or its master password.
"""
import json
from pathlib import Path
from database import connect, public_structure, staff_auth
from snapshot import require

ROOT=Path(__file__).resolve().parent
MIGRATION=ROOT/'supabase/migrations/20261107035249_canto_auth_sync.sql'

def install(environment):
    with connect(environment) as c, c.transaction():
        require(c.execute('select pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],'Refresh running')
        before=public_structure(c); staff=staff_auth(c)
        c.execute(MIGRATION.read_text())
        require(public_structure(c)==before,'Public schema changed')
        require(staff_auth(c)==staff,'Staff records changed')

def enroll(c, only_id=None):
    # Serialize credential changes with GoTrue login/session creation before revoking sessions.
    c.execute('SELECT a.id FROM auth.users a JOIN sa_identity.sa_auth_identities m ON m.auth_user_id=a.id WHERE (%s::bigint IS NULL OR m.legacy_user_id=%s) ORDER BY a.id FOR UPDATE OF a',(only_id,only_id)).fetchall()
    c.execute('LOCK TABLE sa_identity.sa_auth_identities IN SHARE ROW EXCLUSIVE MODE')
    c.execute('''CREATE TEMP TABLE canto_auth_desired ON COMMIT DROP AS
      WITH source AS (SELECT s.*,lower(btrim(email)) ce,
        count(*) OVER (PARTITION BY lower(btrim(email))) email_count
        FROM sa_snapshot_20261019.sa_users s)
      SELECT s.id,s.ce email,s.encrypted_password,s.role,s.confirmed_at,
        (s.deleted_at IS NULL AND s.disabled IS NOT TRUE AND NOT(coalesce(s.role=3,false) AND s.approved IS FALSE)) source_login_allowed,
        (s.deleted_at IS NULL AND s.disabled IS NOT TRUE
         AND NOT(coalesce(s.role=3,false) AND s.approved IS FALSE)
         AND s.ce ~ '^[^[:space:]@]+@[^[:space:]@]+$'
         AND length(s.ce)<=254 AND s.email_count=1
         AND s.encrypted_password ~ '^[$]2[aby][$][0-9]{2}[$][./A-Za-z0-9]{53}$'
         AND s.role BETWEEN 0 AND 12
         AND NOT EXISTS(SELECT FROM auth.users a WHERE lower(btrim(a.email))=s.ce
           AND NOT EXISTS(SELECT FROM sa_identity.sa_auth_identities m WHERE m.auth_user_id=a.id AND m.legacy_user_id=s.id))
         AND NOT EXISTS(SELECT FROM sa_identity.sa_auth_identities m WHERE m.canonical_email=s.ce AND m.legacy_user_id<>s.id)
        ) IS TRUE eligible
      FROM source s WHERE (%s::bigint IS NULL OR s.id=%s)''',(only_id,only_id))
    c.execute('INSERT INTO sa_sync.legacy_identity_keys SELECT id FROM canto_auth_desired ON CONFLICT DO NOTHING')
    c.execute('''INSERT INTO sa_identity.sa_auth_identities
      (auth_user_id,legacy_user_id,canonical_email,import_disposition,enrollment_state,source_was_confirmed,confirmation_basis)
      SELECT gen_random_uuid(),id,email,CASE WHEN eligible THEN 'candidate' WHEN source_login_allowed THEN 'identity_exception' ELSE 'inactive' END,
       CASE WHEN eligible THEN 'pending' ELSE 'blocked' END,confirmed_at IS NOT NULL,
       CASE WHEN confirmed_at IS NOT NULL THEN 'source_confirmed' WHEN eligible THEN 'owner_approved_grandfather' ELSE 'not_activated' END
      FROM canto_auth_desired ON CONFLICT(legacy_user_id) DO NOTHING''')
    c.execute('''UPDATE sa_identity.sa_auth_identities m SET enrollment_state=CASE WHEN d.eligible THEN 'ready' ELSE 'blocked' END
      FROM canto_auth_desired d WHERE d.id=m.legacy_user_id AND m.enrollment_state IS DISTINCT FROM CASE WHEN d.eligible THEN 'ready' ELSE 'blocked' END''')
    if only_id is None:
        c.execute("UPDATE sa_identity.sa_auth_identities m SET enrollment_state='blocked' WHERE NOT EXISTS(SELECT FROM canto_auth_desired d WHERE d.id=m.legacy_user_id) AND enrollment_state<>'blocked'")
    # Revoke existing refresh sessions whenever credentials, role, or eligibility changes.
    c.execute('''CREATE TEMP TABLE canto_auth_revoke ON COMMIT DROP AS
      SELECT a.id FROM auth.users a JOIN sa_identity.sa_auth_identities m ON m.auth_user_id=a.id
      LEFT JOIN canto_auth_desired d ON d.id=m.legacy_user_id
      WHERE (d.id IS NOT NULL OR %s) AND (d.eligible IS NOT TRUE OR a.encrypted_password IS DISTINCT FROM d.encrypted_password
       OR a.email IS DISTINCT FROM d.email OR a.raw_app_meta_data->>'legacy_role_id' IS DISTINCT FROM d.role::text)''',(only_id is None,))
    c.execute('DELETE FROM auth.refresh_tokens WHERE user_id IN (SELECT id::text FROM canto_auth_revoke)')
    c.execute('DELETE FROM auth.sessions WHERE user_id IN (SELECT id FROM canto_auth_revoke)')
    # Match GoTrue's standard email/password account shape; no plaintext password or mail is generated.
    created=c.execute('''INSERT INTO auth.users
      (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,
       email_change_token_new,email_change,raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at)
      SELECT '00000000-0000-0000-0000-000000000000'::uuid,m.auth_user_id,'authenticated','sa_app',d.email,d.encrypted_password,
       coalesce(d.confirmed_at,now()),'','','','',jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
       'application','canto','legacy_user_id',d.id,'legacy_role_id',d.role), '{}'::jsonb,false,now(),now()
      FROM canto_auth_desired d JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=d.id
      WHERE d.eligible AND NOT EXISTS(SELECT FROM auth.users a WHERE a.id=m.auth_user_id)
      RETURNING id''').fetchall()
    c.execute('''UPDATE auth.users a SET encrypted_password=d.encrypted_password,email=d.email,
      email_confirmed_at=coalesce(a.email_confirmed_at,d.confirmed_at,now()),banned_until=NULL,
      raw_app_meta_data=coalesce(a.raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
       'application','canto','legacy_user_id',d.id,'legacy_role_id',d.role),updated_at=now()
      FROM sa_identity.sa_auth_identities m JOIN canto_auth_desired d ON d.id=m.legacy_user_id
      WHERE a.id=m.auth_user_id AND d.eligible AND (a.email IS DISTINCT FROM d.email OR a.encrypted_password IS DISTINCT FROM d.encrypted_password
       OR a.banned_until IS NOT NULL OR a.email_confirmed_at IS NULL OR a.raw_app_meta_data->>'legacy_role_id' IS DISTINCT FROM d.role::text)''')
    c.execute('''UPDATE auth.users a SET banned_until='2126-01-01',updated_at=now()
      FROM sa_identity.sa_auth_identities m WHERE a.id=m.auth_user_id AND m.enrollment_state='blocked'
      AND (a.banned_until IS NULL OR a.banned_until<'2100-01-01')''')
    c.execute('''INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
      SELECT a.id::text,a.id,jsonb_build_object('sub',a.id::text,'email',a.email,'email_verified',true,'phone_verified',false),'email',now(),now()
      FROM auth.users a JOIN sa_identity.sa_auth_identities m ON m.auth_user_id=a.id
      WHERE m.enrollment_state='ready'
      ON CONFLICT(provider_id,provider) DO UPDATE SET identity_data=excluded.identity_data,updated_at=now()
      WHERE auth.identities.identity_data IS DISTINCT FROM excluded.identity_data''')
    c.execute('SET CONSTRAINTS ALL IMMEDIATE')
    bad=c.execute('''SELECT count(*) FROM canto_auth_desired d JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=d.id
      LEFT JOIN auth.users a ON a.id=m.auth_user_id
      WHERE d.eligible AND (a.id IS NULL OR a.role<>'sa_app' OR a.email IS DISTINCT FROM d.email
       OR a.encrypted_password IS DISTINCT FROM d.encrypted_password OR a.banned_until IS NOT NULL
       OR a.raw_app_meta_data->>'legacy_user_id' IS DISTINCT FROM d.id::text
       OR a.raw_app_meta_data->>'legacy_role_id' IS DISTINCT FROM d.role::text)''').fetchone()[0]
    require(bad==0,'Auth parity mismatch')
    counts=c.execute('SELECT count(*),count(*) FILTER(WHERE eligible),count(*) FILTER(WHERE source_login_allowed) FROM canto_auth_desired').fetchone()
    return {'source_users':counts[0],'eligible_users':counts[1],'blocked_or_exception':counts[0]-counts[1],
       'inactive_users':counts[0]-counts[2],'identity_exception_count':counts[2]-counts[1],
       'identity_exception_legacy_ids':[r[0] for r in c.execute('SELECT id FROM canto_auth_desired WHERE source_login_allowed AND NOT eligible ORDER BY id')],
       'new_auth_users':len(created),'password_hash_role_identity_parity':True}

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('environment',choices=['staging','production']);p.add_argument('--install',action='store_true');p.add_argument('--only-id',type=int)
    a=p.parse_args()
    if a.install:install(a.environment)
    with connect(a.environment) as c,c.transaction():
        require(c.execute('select pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],'Refresh running')
        pub=public_structure(c);staff=staff_auth(c)
        result=enroll(c,a.only_id)
        require(public_structure(c)==pub,'Public schema changed');require(staff_auth(c)==staff,'Staff Auth changed')
    print(json.dumps(result))
