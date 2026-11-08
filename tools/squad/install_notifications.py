"""Install FCM credentials on staging in mandatory validation-only mode.

Existing approved Rails credentials stay in memory. No production secrets or
deployments are changed, and imported device tokens are never subscribed.
"""
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from management import api
from install_jobs import run as deploy_jobs
def run():
 source=json.loads((ROOT/'../Canto/scott-international-backend/scott-firebase-adminsdk.json').read_text())
 assert source['project_id']=='scott-75a12' and source['type']=='service_account'
 account={key:source[key] for key in ['project_id','client_email','private_key']}
 api('staging','/secrets',[{'name':'SQUAD_FIREBASE_SERVICE_ACCOUNT','value':json.dumps(account)},{'name':'SQUAD_PUSH_MODE','value':'validate_only'}],method='POST')
 deploy_jobs()
 print(json.dumps({'environment':'staging','push_mode':'validate_only','imported_devices_subscribed':False}))
if __name__=='__main__':run()
