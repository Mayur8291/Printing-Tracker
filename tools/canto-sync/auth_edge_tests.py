"""Staging-only account-state tests; source server is never modified here."""
import json
from pathlib import Path
from database import connect,staff_auth,public_structure
from auth_sync import enroll
from auth_test import login
from psycopg import sql
P=Path(__file__).resolve().parent
x=json.loads((P/'private/auth-test.json').read_text())
ID=7692

def mutate(c,values):
    c.execute(sql.SQL('UPDATE sa_snapshot_20261019.sa_users SET {} WHERE id=%s').format(
      sql.SQL(',').join(sql.SQL('{}=%s').format(sql.Identifier(k)) for k in values)),[*values.values(),ID])
    enroll(c,ID)

with connect('staging') as c:
    assert c.execute('select pg_try_advisory_lock(20261107,1)').fetchone()[0]
    assert c.execute('SELECT email FROM sa_snapshot_20261019.sa_users WHERE id=7692').fetchone()[0]==x['email'],'Unexpected test-account identity'
    original=c.execute('SELECT disabled,approved,deleted_at,email,role FROM sa_snapshot_20261019.sa_users WHERE id=%s',(ID,)).fetchone()
    saved=dict(zip(['disabled','approved','deleted_at','email','role'],original))
    staff=staff_auth(c);pub=public_structure(c);passed=[]
    try:
        for name,values in [('disabled',{'disabled':True}),('unapproved_customer',{'approved':False}),('soft_deleted',{'deleted_at':'2026-11-07T00:00:00Z'})]:
            with c.transaction():mutate(c,{**saved,**values})
            code,body=login('staging',x)
            assert code==400 and body.get('error_code')=='user_banned',(name,code,body.get('error_code'))
            passed.append(name+'_login_blocked')
        with c.transaction():mutate(c,saved)
        assert login('staging',x)[0]==200
        passed.append('reactivated_same_password')
        # Null approval is allowed by Rails authenticate (only explicit false rejects).
        with c.transaction():mutate(c,{'approved':None})
        assert login('staging',x)[0]==200
        passed.append('null_approval_matches_rails')
        with c.transaction():mutate(c,{**saved,'email':'canto-auth-fixture@local'})
        assert login('staging',{**x,'email':'canto-auth-fixture@local'})[0]==200
        passed.append('legacy_domain_without_dot_supported')
        with c.transaction():mutate(c,{**saved,'role':10})
        code,r=login('staging',x)
        assert code==200 and r['user']['app_metadata']['legacy_role_id']==10
        passed.append('role_change_synced')
    finally:
        with c.transaction():mutate(c,saved)
    assert public_structure(c)==pub and staff_auth(c)==staff
    assert login('staging',x)[0]==200
    passed+=['original_state_restored','staff_unchanged','public_schema_unchanged']
    (P/'auth-edge-verification.json').write_text(json.dumps({'passed':passed},indent=2)+'\n')
    print(json.dumps(passed))
