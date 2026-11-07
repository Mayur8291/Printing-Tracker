"""Staging end-to-end login check. Private fixture originates in Rails welcome mail."""
import json,urllib.request,urllib.error,os,base64
os.umask(0o077)
from pathlib import Path
from management import api,PROJECTS,query
ROOT=Path(__file__).resolve().parent

def request(url,body=None,headers=None):
    req=urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,
      headers={'Content-Type':'application/json',**(headers or {})})
    try:
        with urllib.request.urlopen(req,timeout=45) as r:
            raw=r.read();return r.status,json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:return e.code,json.load(e)
        except:return e.code,{}

def keys(environment):
    values=api(environment,'/api-keys')
    return next(x['api_key'] for x in values if x['name']=='anon')

def login(environment,credentials):
    return request('https://'+PROJECTS[environment]+'.supabase.co/auth/v1/token?grant_type=password',credentials,{'apikey':keys(environment)})

def run():
    x=json.loads((ROOT/'private/auth-test.json').read_text())
    old_code,old=request('http://64.227.186.227/api/v1/auth/authenticate',x)
    assert old_code==200 and old.get('success'),'Legacy login failed'
    code,new=login('staging',x)
    if code!=200:raise RuntimeError('Supabase login failed: '+str(code)+' '+str(new.get('error_code'))+' '+str(new.get('msg')))
    user=new['user']; legacy=old['data']['user'];meta=user['app_metadata']
    assert user['role']=='sa_app' and meta['legacy_user_id']==legacy['id'] and meta['legacy_role_id']==3
    assert not query('staging',"select 1 from public.profiles where id='"+user['id']+"'")
    bad,_=login('staging',{'email':x['email'],'password':x['password']+'-incorrect'})
    assert bad==400,'Incorrect password accepted'
    key=keys('staging');base='https://'+PROJECTS['staging']+'.supabase.co'
    claims=json.loads(base64.urlsafe_b64decode(new['access_token'].split('.')[1]+'==='))
    assert claims['sub']==user['id'] and claims['role']=='sa_app' and claims['app_metadata']['legacy_user_id']==legacy['id']
    validated,current=request(base+'/auth/v1/user',headers={'apikey':key,'Authorization':'Bearer '+new['access_token']})
    assert validated==200 and current['id']==user['id'],'Session validation failed'
    status,_=request(base+'/rest/v1/profiles?select=id&limit=1',headers={'apikey':key,'Authorization':'Bearer '+new['access_token']})
    assert status in (401,403),'Canto token unexpectedly accesses staff profiles'
    (ROOT/'private/auth-test-session.json').write_text(json.dumps(new))
    previous=json.loads((ROOT/'auth-verification.json').read_text()) if (ROOT/'auth-verification.json').exists() else None
    if previous:assert previous['supabase_user_id']==user['id'],'Auth identity changed'
    original=ROOT/'private/auth-test-original.json'
    if original.exists():assert login('staging',json.loads(original.read_text()))[0]==400,'Previous password still accepted'
    result={'password_change_sync_verified':original.exists(),'stable_auth_uuid':previous is not None,'old_password_login':True,'supabase_same_password_login':True,'legacy_user_id':legacy['id'],
      'supabase_user_id':user['id'],'role':user['role'],'legacy_role_id':meta['legacy_role_id'],
      'jwt_identity_role_verified':True,'authenticated_session_validated':True,'wrong_password_rejected':True,'no_staff_profile':True,'staff_data_denied':True}
    (ROOT/'auth-verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':run()
