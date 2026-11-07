"""Staging-only refresh-session revocation check, with unconditional restoration."""
import json
from pathlib import Path
from database import connect
from auth_sync import enroll
from auth_test import login,request,keys,PROJECTS
P=Path(__file__).resolve().parent
x=json.loads((P/'private/auth-test.json').read_text())
with connect('staging') as c:
    assert c.execute('select pg_try_advisory_lock(20261107,1)').fetchone()[0]
    assert c.execute('SELECT email FROM sa_snapshot_20261019.sa_users WHERE id=7692').fetchone()[0]==x['email'],'Unexpected test-account identity'
    code,session=login('staging',x);assert code==200
    original=c.execute('SELECT disabled FROM sa_snapshot_20261019.sa_users WHERE id=7692').fetchone()[0]
    try:
        with c.transaction():
            c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=7692');enroll(c,7692)
        code,r=request('https://'+PROJECTS['staging']+'.supabase.co/auth/v1/token?grant_type=refresh_token',
            {'refresh_token':session['refresh_token']},{'apikey':keys('staging')})
        assert code==400 and r.get('error_code') in ('refresh_token_not_found','refresh_token_already_used','user_banned'),(code,r.get('error_code'))
    finally:
        with c.transaction():
            c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=%s WHERE id=7692',(original,));enroll(c,7692)
    assert login('staging',x)[0]==200
    (P/'auth-session-verification.json').write_text(json.dumps({'refresh_token_revoked_on_disable':True,'original_state_restored':True},indent=2)+'\n')
    print('Refresh token rejected after disable; original account state restored.')
