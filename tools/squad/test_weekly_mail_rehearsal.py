"""Exact weekly+PDF mail rehearsal: normal queue remains paused, no SMTP here."""
import unittest,uuid
from contextlib import contextmanager
import psycopg
from psycopg.types.json import Jsonb
from fixtures import rpc,session,uid
from local_db import connect
from test_catalogue import seed_catalogue
import test_production_execution as work
from test_hosted_personas import controlled_alias

class WeeklyMailRehearsal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c:seed_catalogue(c)
    actor=work.Execution.actor
    raw=work.Execution.raw
    iv=work.Execution.iv
    cut=work.Execution.cut
    assign=work.Execution.assign
    inspect=work.Execution.inspect
    dispatch=work.Execution.dispatch
    tearDown=work.Execution.tearDown
    def setUp(self):
        work.Execution.setUp(self)
        self.raw("UPDATE sa_sync.environment_state SET cutover=false,environment='staging',active_job=NULL")
        self.raw("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=clock_timestamp()+interval '15 minutes'",([uid(x) for x in [100,102,103,104,107,108,109]],))
        # Local synthetic seed only; hosted fixtures insert their final emails.
        self.run=uuid.uuid4();self.inbox='squad-acceptance@example.com'
        self.raw('ALTER TABLE sa_identity.sa_auth_identities DISABLE TRIGGER sa_protect_reservation')
        for n in [100,102,103,104]:
            self.raw('UPDATE auth.users SET email=%s WHERE id=%s',(controlled_alias(self.inbox,self.run,n-100),uid(n)))
            self.raw('UPDATE sa_snapshot_20261019.sa_users SET email=%s WHERE id=%s',(controlled_alias(self.inbox,self.run,n-100),n))
            self.raw('UPDATE sa_identity.sa_auth_identities SET canonical_email=%s WHERE legacy_user_id=%s',(controlled_alias(self.inbox,self.run,n-100),n))
            self.raw('UPDATE sa_snapshot_20261019.sa_users SET name=%s WHERE id=%s',(f'SQB {self.run.hex[:12]} role{n-100}',n))
        self.raw('ALTER TABLE sa_identity.sa_auth_identities ENABLE TRIGGER sa_protect_reservation')
        self.cut(3);self.assign(3);self.inspect(3);self.dispatch(3)
        self.raw("UPDATE sa_snapshot_20261019.sa_job_sheet_assign_dates SET assign_at=(sa_domain.weekly_tailor_latest_week(statement_timestamp())::timestamp+interval '2 days') AT TIME ZONE 'Asia/Kolkata' WHERE item_id=1001")
        self.raw("INSERT INTO sa_snapshot_20261019.sa_products(id,product_type,name,base_product_id,created_at,updated_at) VALUES(90001,0,'Weekly synthetic',1,now(),now())")
        self.raw('UPDATE sa_snapshot_20261019.sa_items SET product_id=90001 WHERE id=1001')
        self.actor(100)
        a=rpc(self.c,'v1_document_request',('catalogue',Jsonb({'selection':{'class_ids':['1']},'delivery':'email'}),uuid.uuid4()))
        self.actor(107)
        dispatch=self.raw('SELECT id FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE item_id=1001')[0][0]
        b=rpc(self.c,'v1_document_request',('delivery_challan',Jsonb({'item_id':'1001','dispatch_id':str(dispatch),'delivery':'email'}),uuid.uuid4()))
        self.docs=[uuid.UUID(a['id']),uuid.UUID(b['id'])]
        self.actor(100)
        rpc(self.c,'v1_mail_settings_save',('tailor_weekly',[100,102,104],'0:0',uuid.uuid4()))
        rpc(self.c,'v1_weekly_tailor_schedule_configure',(True,'0:0',uuid.uuid4()))
        self.cap=uuid.uuid4()
    @contextmanager
    def rejects(self,code):
        with self.assertRaises(psycopg.DatabaseError) as caught:
            with self.c.transaction():yield
        self.assertEqual(caught.exception.sqlstate,code)
    def register(self,**changes):
        vals={'id':self.cap,'owner':100,'tailor':105,'recipients':[100,102,103,104],'docs':self.docs}
        vals.update(changes)
        self.raw("INSERT INTO sa_domain.weekly_mail_rehearsals(id,fixture_run_id,controlled_inbox,generation,owner_user_id,tailor_id,recipient_ids,manual_documents,expires_at) VALUES(%s,%s,%s,0,%s,%s,%s,%s,clock_timestamp()+interval '10 minutes')",(vals['id'],self.run,self.inbox)+tuple(vals[k] for k in ['owner','tailor','recipients','docs']))
    def worker(self):
        self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
    def tick(self,cap=None):
        self.worker();return self.c.execute('SELECT canto_api.squad_weekly_mail_rehearsal_tick(%s)',(cap or self.cap,)).fetchone()[0]
    def call(self,name,j,value=None):
        self.worker();args=(uuid.UUID(j['id']),uuid.UUID(j['lease_token']))
        if value is not None:args+=(Jsonb(value) if isinstance(value,dict) else value,)
        return self.c.execute('SELECT canto_api.'+name+'('+','.join(['%s']*len(args))+')',args).fetchone()[0]
    def begin(self,j,cap=None):
        self.worker();return self.c.execute('SELECT canto_api.squad_weekly_mail_rehearsal_send_begin(%s,%s,%s)',(cap or self.cap,uuid.UUID(j['id']),uuid.UUID(j['lease_token']))).fetchone()[0]
    def next_mail(self):
        for _ in range(10):
            jobs=self.tick()['jobs'];self.assertEqual(len(jobs),1);j=jobs[0]
            if j['handler']=='business_mail':
                m=self.call('squad_business_mail_prepare',j);self.assertEqual(m['state'],'prepared');return j,m
            if j['handler']=='document_render':
                m=self.call('squad_document_prepare',j);self.assertEqual(m['state'],'prepared')
                self.assertEqual(self.call('squad_document_finish',j,{'code':'READY','bytes':1000,'pages':1,'sha256':'a'*64})['state'],'done')
            else:self.assertEqual(self.call('squad_document_mail_prepare',j)['state'],'done')
        self.fail('No bounded delivery')
    def test_registration_requires_exact_controlled_alias_and_source_name(self):
        original=self.inbox
        for value in ['squad-acceptance@mailinator.com','bad+tag@example.com','bad\r\n@example.com','a'*60+'@example.com']:
            self.inbox=value
            with self.rejects('22023'):self.register()
        self.inbox='other@example.com'
        with self.rejects('42501'):self.register()
        self.inbox=original
        self.raw("UPDATE sa_snapshot_20261019.sa_users SET email='different@example.com' WHERE id=100")
        with self.rejects('42501'):self.register()
        self.raw('UPDATE sa_snapshot_20261019.sa_users SET email=%s,name=%s WHERE id=100',(controlled_alias(self.inbox,self.run,0),'Unrelated administrator'))
        with self.rejects('42501'):self.register()

    def test_lock_owner_has_no_bypass_or_direct_write_authority(self):
        self.register()
        self.assertEqual(self.raw("SELECT r.rolname,r.rolsuper,r.rolbypassrls,r.rolcanlogin FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='sa_domain.weekly_mail_lock(uuid)'::regprocedure"),[('sa_mail_lock',False,False,False)])
        self.assertEqual(self.raw("SELECT count(*) FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.pronamespace='sa_domain'::regnamespace AND p.prosecdef AND(r.rolsuper OR r.rolbypassrls) AND p.oid NOT IN('sa_domain.auth_context()'::regprocedure,'sa_domain.revoke_account_sessions(bigint)'::regprocedure)"),[(0,)])
        for role in ['anon','authenticated','sa_app','service_role','sa_worker']:
            self.assertEqual(self.raw('SELECT pg_has_role(%s,%s,%s)',(role,'sa_mail_lock','MEMBER')),[(False,)])
        for role in ['anon','authenticated','sa_app','service_role']:
            self.assertEqual(self.raw('SELECT has_function_privilege(%s,%s,%s)',(role,'sa_domain.weekly_mail_lock(uuid)','EXECUTE')),[(False,)])
        self.tick()  # Exercise all five row-lock grants under the narrow owner.
        for statement in ["UPDATE sa_domain.weekly_mail_rehearsals SET id=id", "UPDATE sa_domain.weekly_tailor_schedule SET singleton=singleton", "UPDATE sa_domain.business_mail_settings SET kind=kind", "UPDATE sa_domain.weekly_tailor_runs SET id=id", "UPDATE sa_domain.weekly_tailor_entries SET document_id=document_id"]:
            self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE sa_mail_lock')
            with self.rejects('42501'):self.c.execute(statement)
        self.c.execute('RESET ROLE')

    def test_exact_scheduler_roots_and_five_current_recipients(self):
        self.register();seen=[]
        for _ in range(5):
            j,m=self.next_mail();binding=self.begin(j);self.assertEqual(binding['allowed_recipient'],m['email']);seen.append((m['kind'],m['email']))
            self.assertEqual(self.call('squad_business_mail_finish',j,'SENT')['state'],'done')
        self.assertEqual(self.tick()['jobs'],[])
        self.assertEqual({k for k,e in seen},{'catalogue','delivery_challan','tailor_weekly'})
        self.assertEqual({e for k,e in seen if k=='tailor_weekly'},{controlled_alias(self.inbox,self.run,n-100) for n in [100,102,104]})
        self.assertEqual(self.raw('SELECT tailor_id FROM sa_domain.weekly_tailor_entries'),[(105,)])
        self.assertEqual(self.raw('SELECT cutover FROM sa_sync.environment_state'),[(False,)])
        self.worker();self.assertTrue(self.c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['paused'])
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.weekly_mail_context'),[(0,)])
    def test_lost_smtp_response_never_reclaims_delivery(self):
        self.register();j,m=self.next_mail();self.begin(j)
        self.call('squad_business_mail_finish',j,'PROVIDER_UNAVAILABLE')
        self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(j['id']),))
        next_ids=[x['id'] for x in self.tick()['jobs']];self.assertNotIn(j['id'],next_ids)
        self.assertEqual(self.raw('SELECT state FROM sa_domain.weekly_mail_sends WHERE job_id=%s',(uuid.UUID(j['id']),)),[('unknown',)])
    def test_lost_finish_response_preserves_started_marker(self):
        self.register();j,m=self.next_mail();self.begin(j)
        self.raw("UPDATE sa_domain.outbox SET lease_until=now()-interval '1 second' WHERE id=%s",(uuid.UUID(j['id']),))
        self.assertNotIn(j['id'],[x['id'] for x in self.tick()['jobs']])
        self.assertEqual(self.raw('SELECT state FROM sa_domain.weekly_mail_sends WHERE job_id=%s',(uuid.UUID(j['id']),)),[('started',)])
    def test_duplicate_send_begin_is_conflict(self):
        self.register();j,m=self.next_mail();self.begin(j)
        with self.rejects('PT409'):self.begin(j)
    def test_sent_without_durable_begin_is_denied(self):
        self.register();j,m=self.next_mail()
        with self.rejects('42501'):self.call('squad_business_mail_finish',j,'SENT')
    def test_empty_automatic_week_is_not_accepted(self):
        self.register();self.raw('UPDATE sa_snapshot_20261019.sa_job_sheet_assign_dates SET assign_at=now() WHERE item_id=1001')
        for _ in range(5):
            j=self.tick()['jobs'][0]
            kind=self.raw('SELECT kind FROM sa_domain.documents WHERE job_id=%s',(uuid.UUID(j['id']),))[0][0]
            if kind=='tailor_weekly':
                with self.rejects('55000'):self.call('squad_document_prepare',j)
                return
            self.call('squad_document_prepare',j);self.call('squad_document_finish',j,{'code':'READY','bytes':1000,'pages':1,'sha256':'a'*64})
        self.fail('Weekly root missing')
    def test_foreign_run_cannot_be_adopted_after_registration(self):
        self.register();self.raw('INSERT INTO sa_domain.weekly_tailor_runs(generation,week_start,ceiling_id) SELECT 0,week_start,tailor_id FROM sa_domain.weekly_mail_rehearsals')
        with self.rejects('42501'):self.tick()
    def test_job_payload_change_is_rejected(self):
        self.register();j=self.tick()['jobs'][0];self.raw("UPDATE sa_domain.outbox SET payload=payload||'{\"foreign\":true}' WHERE id=%s",(uuid.UUID(j['id']),))
        with self.rejects('42501'):self.call('squad_document_prepare',j)
    def test_same_value_settings_update_does_not_gain_provenance(self):
        self.register()
        # A separate subtransaction gives the identical update its own xmin.
        with self.c.transaction():self.raw("UPDATE sa_domain.business_mail_settings SET recipient_ids=recipient_ids WHERE kind='tailor_weekly'")
        with self.rejects('42501'):self.tick()
    def test_unknown_capability_denied(self):
        with self.rejects('55000'):self.tick(uuid.uuid4())
    def test_app_cannot_register_or_invoke(self):
        self.actor(100)
        with self.rejects('42501'):self.c.execute('SELECT canto_api.squad_weekly_mail_rehearsal_tick(%s)',(self.cap,))
        with self.rejects('42501'):self.c.execute('SELECT * FROM sa_domain.weekly_mail_rehearsals')
    def test_normal_heartbeat_is_still_paused(self):
        self.register();self.worker();r=self.c.execute('SELECT canto_api.squad_weekly_tailor_heartbeat(25)').fetchone()[0]
        self.assertEqual(r['error_code'],'MIRROR_OR_REFRESH');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.weekly_tailor_entries'),[(0,)])
    def test_live_lease_prevents_parallel_phase(self):
        self.register();self.assertEqual(len(self.tick()['jobs']),1);self.assertEqual(self.tick()['jobs'],[])
    def test_foreign_document_edit_rejected_before_render(self):
        self.register();j=self.tick()['jobs'][0]
        self.raw("UPDATE sa_domain.documents SET error_code='foreign' WHERE job_id=%s",(uuid.UUID(j['id']),))
        with self.rejects('42501'):self.call('squad_document_prepare',j)
    def test_cutover_does_not_adopt_registered_rehearsal_jobs(self):
        self.register();j=self.tick()['jobs'][0];self.raw('UPDATE sa_sync.environment_state SET cutover=true')
        with self.rejects('55000'):self.call('squad_document_prepare',j)
    def test_revoked_capability_blocks_existing_lease(self):
        self.register();j=self.tick()['jobs'][0];self.raw('DELETE FROM sa_domain.weekly_mail_rehearsals WHERE id=%s',(self.cap,))
        with self.rejects('55000'):self.call('squad_document_prepare',j)
    def test_generation_refresh_expiry_and_production_block(self):
        self.register()
        for sql in ["UPDATE sa_sync.environment_state SET environment='production'","UPDATE sa_sync.environment_state SET active_job=gen_random_uuid()","UPDATE sa_domain.runtime_state SET generation=1","UPDATE sa_domain.runtime_state SET test_write_expires_at=now()-interval '1 second'"]:
            with self.c.transaction():
                self.raw(sql)
                with self.rejects('55000'):self.tick()
                raise psycopg.Rollback()
    def test_recipient_email_changed_before_send_denies(self):
        self.register();j,m=self.next_mail();self.raw('UPDATE auth.users SET email=%s WHERE id=(SELECT recipient_auth_id FROM sa_domain.business_mail_deliveries WHERE job_id=%s)',('different@mailinator.com',uuid.UUID(j['id'])))
        with self.rejects('28000'):self.begin(j)
    def test_wrong_recipient_roles_and_noncontrolled_email_denied(self):
        with self.rejects('42501'):self.register(recipients=[100,102,103,204])
        self.raw("UPDATE auth.users SET email='not-controlled@example.com' WHERE id=%s",(uid(100),))
        with self.rejects('42501'):self.register()
    def test_second_capability_rejected(self):
        self.register()
        with self.rejects('55000'):self.register(id=uuid.uuid4())
    def test_wrong_send_capability_rejected(self):
        self.register();j,m=self.next_mail()
        with self.rejects('42501'):self.begin(j,uuid.uuid4())
    def test_changed_weekly_recipients_revokes_remaining_queue(self):
        self.register();self.raw("UPDATE sa_domain.business_mail_settings SET recipient_ids=ARRAY[100] WHERE kind='tailor_weekly'")
        with self.rejects('55000'):self.tick()
    def test_scheduled_request_uses_real_latest_completed_week(self):
        self.register();self.tick()
        actual=self.raw("SELECT request FROM sa_domain.documents WHERE kind='tailor_weekly'")[0][0]
        self.assertEqual(actual['week_start'],str(self.raw('SELECT sa_domain.weekly_tailor_latest_week(statement_timestamp())')[0][0]))
        self.assertEqual(actual['tailor_id'],'105');self.assertFalse(actual['include_team'])

if __name__=='__main__':unittest.main()
