"""Consecutive failures, deterministic validation, and partial-import recovery."""
import json,unittest,uuid
import psycopg
import test_airtable as fixture
from fixtures import uid

class AirtableRecovery(unittest.TestCase):
 setUpClass=classmethod(fixture.Airtable.setUpClass.__func__)
 setUp=fixture.Airtable.setUp;tearDown=fixture.Airtable.tearDown
 actor=fixture.Airtable.actor;service=fixture.Airtable.service;raw=fixture.Airtable.raw
 start=fixture.Airtable.start;claim=fixture.Airtable.claim;work=fixture.Airtable.work
 status=fixture.Airtable.status;capture=fixture.Airtable.capture;validate=fixture.Airtable.validate
 reset_sequences=fixture.Airtable.reset_sequences;full_rows=fixture.Airtable.full_rows
 partial_prices=fixture.Airtable.partial_prices;repair_statistics=fixture.Airtable.repair_statistics
 media_fixture=fixture.Airtable.media_fixture

 def attempts(self,j):return self.raw('SELECT attempts FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),))[0][0]
 def set_attempts(self,j,n):self.raw('UPDATE sa_domain.outbox SET attempts=%s WHERE id=%s',(n,uuid.UUID(j['id'])))
 def due(self,j):self.raw("UPDATE sa_domain.outbox SET available_at=now()-interval '1 second' WHERE id=%s",(uuid.UUID(j['id']),))
 def page(self,n,offset=None,next_=None):
  return {'resource':'colors','offset':offset,'next_offset':next_,'eof':next_ is None,'records':[fixture.record('colors',n,{'name':f'Recovery {n}','hex_code':'#00ff00'})]}
 def retry(self,j):return self.work(j,'retry',{'code':'AIRTABLE_RATE_LIMIT','retry_after_seconds':30})
 def test_progress_between_retries_survives_more_than_five_leases(self):
  t=self.start();j=self.claim();offset=None
  for n in range(1,8):
   data=self.page(n,offset,f'page:{n}');self.work(j,'capture',data);self.assertEqual(self.attempts(j),1)
   self.assertEqual(self.retry(j)['state'],'pending');self.due(j);j=self.claim();offset=f'page:{n}'
  self.assertEqual(self.status(t)['state'],'validating')
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.airtable_rows WHERE transfer_id=%s',(uuid.UUID(t['id']),)),[(7,)])
 def test_five_consecutive_failures_still_fail_and_release_import_slot(self):
  t=self.start();j=self.claim()
  for n in range(1,6):
   self.assertEqual(self.attempts(j),n);self.work(j,'input');self.assertEqual(self.attempts(j),n)
   r=self.retry(j);self.assertEqual(r['state'],'dead' if n==5 else 'pending')
   if n<5:self.due(j);j=self.claim()
  self.assertEqual(self.status(t)['state'],'failed');self.assertNotEqual(self.start()['id'],t['id'])
 def test_capture_replay_does_not_erase_failure_budget(self):
  self.start();j=self.claim();data=self.page(1,next_='next');self.work(j,'capture',data);self.set_attempts(j,4)
  self.assertEqual(self.work(j,'capture',data)['state'],'ready');self.assertEqual(self.attempts(j),4)
 def test_media_progress_resets_budget_but_receipt_replay_does_not(self):
  self.start();j=self.claim();i=self.capture(j,{'base_product_types':[fixture.record('base_product_types',1,{'name':'Media recovery','position':0},media={'image':self.media_fixture()})]});a=i['assets'][0]
  data={'assets':[{'asset_id':a['asset_id'],'attachment_id':a['attachment']['id'],'status':'ready','manifest':{'bucket':'canto-media','path':'sha256/aa/'+'a'*64,'sha256':'a'*64,'bytes':2048,'mime':'image/png'}}]}
  self.set_attempts(j,4);self.assertEqual(self.work(j,'media',data)['state'],'ready');self.assertEqual(self.attempts(j),1)
  self.set_attempts(j,4);self.assertEqual(self.work(j,'media',data)['state'],'ready');self.assertEqual(self.attempts(j),4)
 def test_validation_and_apply_progress_reset_failure_budget(self):
  t=self.start();j=self.claim();self.capture(j,{});self.set_attempts(j,4)
  self.assertEqual(self.work(j,'validate')['state'],'ready');self.assertEqual(self.attempts(j),1)
  # Finish this empty transfer to release its global slot, then use real prices.
  while self.work(j,'validate')['state']=='ready':pass
  self.actor();s=self.status(t);self.c.execute("SELECT canto_api.v1_import_request('airtable',%s::jsonb,%s)",(json.dumps({'action':'cancel','id':s['id'],'version':s['version']}),uuid.uuid4()))
  t,j=self.partial_prices();self.set_attempts(j,4);self.assertEqual(self.work(j,'apply')['state'],'ready');self.assertEqual(self.attempts(j),1)
 def test_duplicate_record_on_later_page_fails_promptly_without_raw_data(self):
  t=self.start();j=self.claim();self.work(j,'capture',self.page(1,next_='next'))
  d=self.page(1,'next');d['records'][0]['attributes']['name']='private provider content'
  r=self.work(j,'capture',d);self.assertEqual((r['state'],r['error_code']),('dead','AIRTABLE_CAPTURE_CONFLICT'))
  s=self.status(t);self.assertEqual(s['state'],'failed');self.assertNotIn('private provider content',json.dumps(r)+json.dumps(s['result']))
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.airtable_rows WHERE transfer_id=%s',(uuid.UUID(t['id']),)),[(1,)])
  self.assertNotEqual(self.start()['id'],t['id'])
 def test_resource_limit_is_durable_and_current_page_is_rolled_back(self):
  t=self.start();j=self.claim();self.raw("UPDATE sa_domain.airtable_tables SET row_count=150000 WHERE transfer_id=%s AND resource='colors'",(uuid.UUID(t['id']),))
  r=self.work(j,'capture',self.page(1));self.assertEqual((r['state'],r['error_code']),('dead','AIRTABLE_RESPONSE_LIMIT'))
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.airtable_pages WHERE transfer_id=%s',(uuid.UUID(t['id']),)),[(0,)])
  self.assertEqual(self.raw('SELECT state,completed_at IS NOT NULL FROM sa_domain.transfers WHERE id=%s',(uuid.UUID(t['id']),)),[('failed',True)])
 def test_capture_data_error_becomes_sanitized_terminal_failure(self):
  t=self.start();j=self.claim();d=self.page(1);d['records'][0]['attributes']['name']={'private':'payload'}
  r=self.work(j,'capture',d);self.assertEqual((r['state'],r['error_code']),('dead','AIRTABLE_INVALID_RECORD'))
  self.assertEqual(self.status(t)['result']['failure'],{'code':'AIRTABLE_INVALID_RECORD','sqlstate':'22023','action':'capture'})
 def test_serialization_conflict_remains_retryable_without_failed_transfer(self):
  t=self.start();j=self.claim();d=self.page(1,next_='next');self.work(j,'capture',d);d['next_offset']='changed'
  with self.assertRaises(psycopg.errors.SerializationFailure):
   with self.c.transaction():self.work(j,'capture',d)
  self.assertEqual(self.status(t)['state'],'validating');self.assertEqual(self.raw('SELECT status FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),)),[('leased',)])
 def test_deadlock_and_unknown_outcome_are_not_mislabeled_as_invalid_data(self):
  t=self.start();j=self.claim()
  for state in ['40P01','XX000','57014']:
   with self.subTest(sqlstate=state):
    with self.assertRaises(psycopg.Error) as caught:
     with self.c.transaction():
      self.raw("CREATE FUNCTION pg_temp.airtable_failure() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'Synthetic transient failure' USING ERRCODE=TG_ARGV[0];END $f$")
      self.raw("CREATE TRIGGER airtable_synthetic_failure BEFORE INSERT ON sa_domain.airtable_rows FOR EACH ROW EXECUTE FUNCTION pg_temp.airtable_failure(%s)"% psycopg.sql.Literal(state).as_string(self.c))
      self.work(j,'capture',self.page(1))
    self.assertEqual(caught.exception.sqlstate,state);self.assertEqual(self.status(t)['state'],'queued')
 def test_invalid_retry_command_remains_an_api_error(self):
  t=self.start();j=self.claim()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):
   with self.c.transaction():self.work(j,'retry',{'code':'raw secret','retry_after_seconds':30})
  self.assertEqual(self.status(t)['state'],'queued')
 def test_partial_deterministic_failure_preserves_committed_rows_and_repairs_statistics(self):
  t,j=self.partial_prices();before=self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_rmp_prices')
  r=self.work(j,'apply',{'unexpected':'private'});self.assertEqual((r['state'],r['error_code']),('dead','AIRTABLE_APPLY_CONFLICT'))
  s=self.status(t);self.assertTrue(s['result']['partial']);self.assertEqual(before,self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_rmp_prices'))
  self.raw('UPDATE sa_domain.integration_preferences SET airtable_enabled=false');self.raw('DELETE FROM public.profiles WHERE id=%s',(uid(999),));self.repair_statistics(t)
  self.assertEqual(before,self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_rmp_prices'))
 def test_exhausted_partial_lease_finishes_transfer_and_queues_statistics(self):
  t,j=self.partial_prices();self.raw("UPDATE sa_domain.outbox SET attempts=5,lease_until=now()-interval '1 second' WHERE id=%s",(uuid.UUID(j['id']),));self.service();self.c.execute('SELECT canto_api.squad_job_claim(10)')
  s=self.status(t);self.assertEqual(s['state'],'failed');self.assertTrue(s['result']['partial'])
  self.assertEqual(self.raw('SELECT completed_at IS NOT NULL FROM sa_domain.transfers WHERE id=%s',(uuid.UUID(t['id']),)),[(True,)])
  self.repair_statistics(t)

if __name__=='__main__':unittest.main(verbosity=2)
