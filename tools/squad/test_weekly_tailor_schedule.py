"""Scheduled weekly documents: bounded delegation, current authority and no SMTP."""
import unittest,uuid
from datetime import date
import psycopg
from psycopg.types.json import Jsonb
from fixtures import uid,rpc,session
from local_db import connect
from test_catalogue import seed_catalogue
import test_notifications as notifications
class Weekly(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 actor_as=notifications.Notifications.actor_as;raw=notifications.Notifications.raw;worker=notifications.Notifications.worker;claim=notifications.Notifications.claim;call=notifications.Notifications.call
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_sync.environment_state SET cutover=true');self.actor_as(100)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def configure(self,enabled=True,version='0:0',key=None):
  self.actor_as(100);return rpc(self.c,'v1_weekly_tailor_schedule_configure',(enabled,version,key or uuid.uuid4()))
 def enable(self):
  self.raw("UPDATE sa_domain.business_mail_settings SET recipient_ids=ARRAY[100] WHERE kind='tailor_weekly'");return self.configure()
 def beat(self,limit=25):self.worker();return self.c.execute('SELECT canto_api.squad_weekly_tailor_heartbeat(%s)',(limit,)).fetchone()[0]
 def test_disabled_default_and_private_state(self):
  self.assertFalse(rpc(self.c,'v1_weekly_tailor_schedule_status')['enabled']);self.assertEqual(self.beat()['state'],'disabled');self.actor_as(100)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.c.execute('SELECT * FROM sa_domain.weekly_tailor_entries')
 def test_boundary_is_saturday_0001_kolkata(self):
  for at,expected in [('2026-11-06 18:29:59+00','2026-10-24'),('2026-11-06 18:30:00+00','2026-10-24'),('2026-11-06 18:30:59+00','2026-10-24'),('2026-11-06 18:31:00+00','2026-10-31'),('2026-11-07 23:00:00+00','2026-10-31')]:
   with self.subTest(at=at):self.assertEqual(str(self.raw('SELECT sa_domain.weekly_tailor_latest_week(%s::timestamptz)',(at,))[0][0]),expected)
 def test_enable_requires_configured_authorized_recipients(self):
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.configure()
 def test_only_current_admin_can_delegate_itself(self):
  self.actor_as(104)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_weekly_tailor_schedule_configure',(True,'0:0',uuid.uuid4()))
 def test_caller_cannot_invoke_heartbeat_or_arbitrary_time(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.squad_weekly_tailor_heartbeat(25)')
 def test_setting_is_idempotent_and_compare_and_swap(self):
  self.raw("UPDATE sa_domain.business_mail_settings SET recipient_ids=ARRAY[100] WHERE kind='tailor_weekly'");key=uuid.uuid4();first=self.configure(key=key);self.assertEqual(first,self.configure(key=key));self.assertEqual(first['owner_user_id'],'100')
  with self.assertRaises(psycopg.errors.SerializationFailure):self.configure(False)
 def test_initial_enable_uses_only_latest_completed_week(self):
  status=self.enable();latest=self.raw('SELECT sa_domain.weekly_tailor_latest_week(statement_timestamp())')[0][0];self.assertEqual(status['next_week_start'],str(latest));r=self.beat();self.assertEqual(r['week_start'],str(latest));self.assertEqual(r['state'],'queued');self.assertGreater(r['queued'],0);self.assertEqual(self.beat()['state'],'waiting')
 def test_queued_documents_exact_request_and_delegated_owner(self):
  self.enable();self.beat();rows=self.raw('SELECT actor_id,legacy_user_id,role_id,kind,request,delivery_state FROM sa_domain.documents');self.assertTrue(rows)
  for owner,user,role,kind,request,delivery in rows:
   self.assertEqual((owner,user,role,kind,delivery),(uid(100),100,0,'tailor_weekly','pending'));self.assertFalse(request['include_team']);self.assertEqual(request['delivery'],'email');self.assertEqual(self.raw('SELECT role FROM sa_snapshot_20261019.sa_users WHERE id=%s',(int(request['tailor_id']),)),[(5,)])
 def test_bounded_pages_fixed_ceiling_and_repeat_safe(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_users(id,name,role,email,disabled,created_at,updated_at) SELECT 10000+x,'Schedule tailor',5,'schedule'||x||'@squad.invalid',false,now(),now() FROM generate_series(1,61) x");self.enable();first=self.beat();self.assertEqual((first['state'],first['queued']),('running',25));self.raw("INSERT INTO sa_snapshot_20261019.sa_users(id,name,role,email,created_at,updated_at) VALUES(999999,'Later tailor',5,'later@squad.invalid',now(),now())")
  for _ in range(5):
   r=self.beat();self.assertLessEqual(r['queued'],25)
   if r['state']=='waiting':break
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.weekly_tailor_runs'),[(1,)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.weekly_tailor_entries WHERE tailor_id=999999'),[(0,)]);before=self.raw('SELECT count(*) FROM sa_domain.documents');self.beat();self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.documents'),before)
 def test_missed_weeks_resume_one_week_per_tick(self):
  self.enable();self.raw('UPDATE sa_domain.weekly_tailor_schedule SET next_week=next_week-14');first=self.beat();second=self.beat();self.assertNotEqual(first['run_id'],second['run_id']);self.assertEqual((date.fromisoformat(second['week_start'])-date.fromisoformat(first['week_start'])).days,7);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.weekly_tailor_runs'),[(2,)])
 def test_mirror_and_refresh_pause_without_queued_rows(self):
  self.enable();self.raw('UPDATE sa_sync.environment_state SET cutover=false');self.assertEqual(self.beat()['error_code'],'MIRROR_OR_REFRESH');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.documents'),[(0,)])
 def test_new_generation_requires_explicit_reenable(self):
  self.enable();self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1');self.assertEqual(self.beat()['error_code'],'SOURCE_REFRESH_RECONFIGURE');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.documents'),[(0,)])
 def test_demoted_or_disabled_owner_does_not_queue(self):
  self.enable();self.raw('UPDATE sa_snapshot_20261019.sa_users SET role=1 WHERE id=100');self.assertEqual(self.beat()['error_code'],'SCHEDULE_OWNER_UNAVAILABLE');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.documents'),[(0,)])
 def test_removed_recipient_configuration_pauses_without_skipping_week(self):
  self.enable();before=self.raw('SELECT next_week FROM sa_domain.weekly_tailor_schedule');self.raw("UPDATE sa_domain.business_mail_settings SET recipient_ids='{}' WHERE kind='tailor_weekly'");self.assertEqual(self.beat()['error_code'],'MAIL_RECIPIENTS_NOT_CONFIGURED');self.assertEqual(self.raw('SELECT next_week FROM sa_domain.weekly_tailor_schedule'),before)
 def test_disabling_after_queue_stops_document_and_preserves_manual_flow(self):
  state=self.enable();self.beat();self.configure(False,state['version']);j=self.claim('document_render')[0];self.assertEqual(self.call('squad_document_prepare',j)['state'],'dead')
 def test_scheduled_pdf_and_mail_use_existing_current_authority_pipeline(self):
  self.enable();self.beat();j=self.claim('document_render')[0];prepared=self.call('squad_document_prepare',j);self.assertEqual(prepared['state'],'prepared');self.assertEqual(prepared['snapshot']['kind'],'tailor_weekly');self.assertEqual(self.call('squad_document_finish',j,Jsonb({'code':'READY','bytes':100,'sha256':'a'*64,'pages':1}))['state'],'done')
  self.raw("UPDATE sa_domain.outbox SET available_at=now()+interval '1 day' WHERE event_type='document.requested' AND status='pending'");mail=self.claim('document_mail')[0];self.assertEqual(self.call('squad_document_mail_prepare',mail)['state'],'done');deliver=self.claim('business_mail')[0];body=self.call('squad_business_mail_prepare',deliver);self.assertEqual(body['state'],'prepared');self.assertEqual(body['kind'],'tailor_weekly');self.assertIn('attachment',body)
 def test_banned_owner_cannot_render_or_send(self):
  self.enable();self.beat();self.raw("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=%s",(uid(100),));j=self.claim('document_render')[0];self.assertEqual(self.call('squad_document_prepare',j)['state'],'dead');self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='document.mail'"),[(0,)])
 def test_disable_after_render_revokes_pending_email(self):
  state=self.enable();self.beat();j=self.claim('document_render')[0];self.call('squad_document_prepare',j);self.call('squad_document_finish',j,Jsonb({'code':'READY','bytes':100,'sha256':'a'*64,'pages':1}));self.configure(False,state['version']);self.raw("UPDATE sa_domain.outbox SET available_at=now()+interval '1 day' WHERE event_type='document.requested' AND status='pending'");mail=self.claim('document_mail')[0];self.assertEqual(self.call('squad_document_mail_prepare',mail)['state'],'dead')
 def test_only_root_tailors_and_non_deleted_subjects_are_scheduled(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET deleted_at=now() WHERE id=205');self.enable();self.beat();self.assertEqual(self.raw('SELECT tailor_id FROM sa_domain.weekly_tailor_entries'),[(105,)])
 def test_empty_tailor_population_completes_without_empty_documents(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET deleted_at=now() WHERE role=5');self.enable();self.assertEqual(self.beat()['state'],'queued');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.documents'),[(0,)]);self.assertEqual(self.beat()['state'],'waiting')
 def test_refresh_then_disable_reenable_resets_initial_week(self):
  self.enable();self.raw('UPDATE sa_domain.weekly_tailor_schedule SET next_week=next_week-21');self.raw('UPDATE sa_domain.runtime_state SET generation=1');self.actor_as(100);v=self.raw("SELECT sa_domain.version('weekly_tailor_schedule',1)")[0][0];disabled=self.configure(False,v);self.configure(True,disabled['version']);self.assertEqual(self.raw('SELECT next_week=sa_domain.weekly_tailor_latest_week(statement_timestamp()) FROM sa_domain.weekly_tailor_schedule'),[(True,)])
 def test_invalid_limit_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.beat(26)
 def test_locked_schedule_is_a_quiet_bounded_noop(self):
  # Commit only the synthetic environment flag so the second connection reaches
  # the scheduler lock; the delegation and all queued business work stay rolled back.
  self.c.execute('ROLLBACK');old=self.c.execute('SELECT cutover FROM sa_sync.environment_state').fetchone()[0];self.c.execute('UPDATE sa_sync.environment_state SET cutover=true');self.c.execute('BEGIN');self.actor_as(100)
  try:
   self.enable();self.raw('SELECT * FROM sa_domain.weekly_tailor_schedule FOR UPDATE')
   with connect() as c:
    c.execute('BEGIN');c.execute("SET LOCAL statement_timeout='2s'");c.execute('SET LOCAL ROLE service_role');c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
    self.assertEqual(c.execute('SELECT canto_api.squad_weekly_tailor_heartbeat(25)').fetchone()[0],{'state':'busy','queued':0});c.execute('ROLLBACK')
  finally:
   self.c.execute('ROLLBACK');self.c.execute('UPDATE sa_sync.environment_state SET cutover=%s',(old,));self.c.execute('BEGIN')

if __name__=='__main__':unittest.main()
