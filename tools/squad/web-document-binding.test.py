"""Actual local SQL browser-key bindings reuse exact worker/cleanup invariants."""
import copy,json,unittest,uuid
from unittest.mock import patch
from psycopg.types.json import Jsonb
import document_output_recovery as outputs
import web_document_output_binding as web
import test_hosted_business_journeys as business
import test_document_output_recovery as base
from fixtures import rpc

class BrowserOutputBinding(unittest.TestCase):
 setUpClass=classmethod(base.DocumentOutputRecovery.setUpClass.__func__)
 setUp=base.DocumentOutputRecovery.setUp;tearDown=base.DocumentOutputRecovery.tearDown;prepared=base.DocumentOutputRecovery.prepared
 composed=base.DocumentOutputRecovery.composed;service=base.DocumentOutputRecovery.service;render_sql=base.DocumentOutputRecovery.render_sql;clean=base.DocumentOutputRecovery.clean
 def browser_requests(self):
  state,result,old=self.composed(register_outputs=False);requests=[]
  for expected in old:
   actor=next(a for a in state['identity']['actors'] if a['role']==expected['role'])
   session=self.c.execute('SELECT id FROM auth.sessions WHERE user_id=%s ORDER BY created_at DESC LIMIT 1',(actor['auth_id'],)).fetchone()[0]
   request=self.c.execute('SELECT request FROM sa_domain.documents WHERE id=%s',(expected['document_id'],)).fetchone()[0]
   label=f"web.role{actor['role']}.42";key=uuid.uuid5(uuid.UUID(state['run_id']),label)
   self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':actor['auth_id'],'session_id':str(session)}),));self.c.execute('SET LOCAL ROLE sa_app')
   saved=rpc(self.c,'v1_document_request',(expected['kind'],Jsonb(request),key));self.c.execute('RESET ROLE')
   result['journal'].append({'kind':'command','value':{'label':label,'key':str(key)}})
   requests.append({'document_id':saved['id'],'role':actor['role'],'kind':expected['kind']})
  state['web_output_rehearsal']=True;state['web_document_output_requests']=requests
  return state,result
 def test_browser_request_registration_worker_provenance_and_exact_cleanup(self):
  state,result=self.browser_requests()
  with patch.object(business,'journal',return_value=result['journal']):
   docs=outputs.register(self.c,state);self.assertEqual(len(docs),2)
   self.render_sql(docs)
   self.assertEqual(outputs.validate(self.c,state),docs)
   cleaned=self.clean(state,result);self.assertEqual(cleaned['removed_processed_documents'],2);self.assertTrue(cleaned['audit_and_commands_retained'])
 def test_binding_rejects_changed_actor_key_kind_or_checkpoint(self):
  state,result=self.browser_requests()
  with patch.object(business,'journal',return_value=result['journal']):
   expected=web.bindings(self.c,state);self.assertEqual(len(expected),2)
   for mutate in [lambda s:s.update(web_output_rehearsal=False),lambda s:s['web_document_output_requests'][0].update(role=3),lambda s:s['web_document_output_requests'][0].update(kind='catalogue'),lambda s:s['web_document_output_requests'][0].update(document_id=str(uuid.uuid4()))]:
    changed=copy.deepcopy(state);mutate(changed)
    with self.assertRaises(AssertionError):web.bindings(self.c,changed)
   tampered=copy.deepcopy(result['journal']);row=next(r for r in tampered if r.get('kind')=='command' and r['value']['label']=='web.role4.42');row['value']['key']=str(uuid.uuid4())
   with patch.object(business,'journal',return_value=tampered):
    with self.assertRaisesRegex(AssertionError,'deterministic'):web.bindings(self.c,state)
   absent=[r for r in result['journal'] if not(r.get('kind')=='command' and r['value']['label'].startswith('web.role'))]
   with patch.object(business,'journal',return_value=absent):
    with self.assertRaisesRegex(AssertionError,'owned browser'):web.bindings(self.c,state)

if __name__=='__main__':unittest.main(verbosity=2)
