"""Create or remove an isolated, confirmed staging administrator for browser acceptance."""
import argparse,json,os,secrets,urllib.request,uuid
from pathlib import Path
from management import api,PROJECTS
from database import connect
os.umask(0o077)
ROOT=Path(__file__).resolve().parent
FILE=ROOT/'private/admin-test.json'

def main(cleanup=False):
    keys=api('staging','/api-keys');service=next(k['api_key'] for k in keys if k['name']=='service_role')
    anon=next(k['api_key'] for k in keys if k['name']=='anon');url='https://'+PROJECTS['staging']+'.supabase.co'
    def auth(path,body=None,method=None):
        req=urllib.request.Request(url+'/auth/v1/admin/'+path,method=method,data=None if body is None else json.dumps(body).encode(),
          headers={'apikey':service,'Authorization':'Bearer '+service,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=45) as response:
            data=response.read();return json.loads(data) if data else None
    if cleanup:
        fixture=json.loads(FILE.read_text())
        assert fixture['url']==url and fixture['email'].startswith('canto-admin-acceptance-') and fixture['email'].endswith('@mailinator.com')
        actual=auth('users/'+fixture['id']);assert actual['email']==fixture['email']
        with connect('staging') as conn:
            assert not conn.execute('SELECT active_job FROM sa_sync.environment_state WHERE singleton').fetchone()[0],'Finish the active test job first'
        auth('users/'+fixture['id'],method='DELETE')
        with connect('staging') as conn:conn.execute('DELETE FROM public.admin_emails WHERE email=%s',(fixture['email'],))
        FILE.unlink();(ROOT/'private/browser-state.json').unlink(missing_ok=True)
        print('Temporary staging administrator and saved browser session removed.');return
    if FILE.exists():fixture=json.loads(FILE.read_text())
    else:
        email='canto-admin-acceptance-'+uuid.uuid4().hex[:12]+'@mailinator.com';password=secrets.token_urlsafe(24)
        user=auth('users',{'email':email,'password':password,'email_confirm':True,'user_metadata':{'full_name':'Canto acceptance test'}})
        fixture={'id':user['id'],'email':email,'password':password,'url':url,'anon':anon}
        FILE.parent.mkdir(exist_ok=True,mode=0o700);FILE.write_text(json.dumps(fixture))
    with connect('staging') as conn:
        with conn.transaction():
            conn.execute('INSERT INTO public.admin_emails(email) VALUES(%s) ON CONFLICT DO NOTHING',(fixture['email'],))
            conn.execute("UPDATE public.profiles SET role='admin' WHERE id=%s",(fixture['id'],))
    print('Staging fixture ready. No email sent. Credentials remain in private/admin-test.json.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--cleanup',action='store_true');main(parser.parse_args().cleanup)
