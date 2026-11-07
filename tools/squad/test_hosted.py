"""Opt-in hosted Auth/Data API checks against the existing controlled staging user.

Run directly, not via local unittest discovery. Never prints credentials or tokens.
"""
import json,sys,time,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from auth_test import login,keys,request
from management import PROJECTS

def run():
    credential_path=Path(os.environ.get('SQUAD_TEST_CREDENTIALS',ROOT.parent/'Canto/canto-sync/private/auth-test.json'))
    credential=json.loads(credential_path.read_text())
    code,auth=login('staging',credential)
    assert code==200,('Auth failed',code,auth.get('error_code'))
    assert auth['user']['role']=='sa_app'
    base='https://'+PROJECTS['staging']+'.supabase.co'
    key=keys('staging')
    headers={'apikey':key,'Authorization':'Bearer '+auth['access_token'],'Content-Profile':'canto_api','Accept-Profile':'canto_api'}
    start=time.monotonic()
    status,me=request(base+'/rest/v1/rpc/v1_me',{},headers)
    assert status==200,('Me failed',status,me.get('code'),me.get('message'))
    assert me['id']==str(auth['user']['app_metadata']['legacy_user_id']) and me['role']==3
    assert not {'encrypted_password','fcm_token','confirmation_token'} & me.keys()
    checks={'live_auth_identity':True,'me_latency_ms':round((time.monotonic()-start)*1000,1)}
    code,error=request(base+'/rest/v1/rpc/v1_profile_save',{'p_fields':{'role':0},'p_expected_version':me['version'],'p_idempotency_key':'26153615-7791-4e55-bef8-3dc37a95d928'},headers)
    assert code==400 and error.get('code')=='22023',(code,error.get('code'));checks['profile_promotion_denied']=True
    code,error=request(base+'/rest/v1/rpc/v1_profile_save',{'p_fields':{'name':me['name']},'p_expected_version':me['version'],'p_idempotency_key':'d0cdfe93-a7aa-4624-a9c3-45c862ca6022'},headers)
    assert code>=400 and error.get('code')=='55000',(code,error.get('code'));checks['mirror_write_denied']=True
    code,_=request(base+'/rest/v1/rpc/access',{},headers)
    assert code in (401,403);checks['staff_admin_api_denied']=True
    code,_=request(base+'/rest/v1/rpc/v1_me',{}, {'apikey':key,'Content-Profile':'canto_api'})
    assert code in (401,403);checks['anonymous_denied']=True
    code,_=request(base+'/rest/v1/sa_users?select=id&limit=1',headers={**headers,'Accept-Profile':'sa_snapshot_20261019'})
    assert code>=400;checks['raw_business_table_denied']=True
    print(json.dumps({'environment':'staging','checks':checks,'business_writes':0}))
    return checks

if __name__=='__main__':run()
