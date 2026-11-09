"""Exact trigger-created channel provenance, isolated synthetic SQL only."""
import unittest,uuid
import test_tracker_read_fixture as base
import tracker_read_fixture as fixture
class TrackerChannelCleanup(unittest.TestCase):
 def setUp(self):
  self.original=base.TrackerReadFixture();self.original.setUp();self.c=self.original.c
  self.c.execute("CREATE TABLE public.team_chat_conversations(id uuid PRIMARY KEY,kind text NOT NULL)")
  self.c.execute("CREATE TABLE public.team_chat_conversation_members(conversation_id uuid REFERENCES public.team_chat_conversations ON DELETE CASCADE,user_id uuid REFERENCES public.profiles ON DELETE CASCADE,role text NOT NULL DEFAULT 'member',joined_at timestamptz NOT NULL DEFAULT now(),last_read_at timestamptz,PRIMARY KEY(conversation_id,user_id))")
  self.channel=uuid.uuid4();self.c.execute("INSERT INTO public.team_chat_conversations VALUES(%s,'channel')",(self.channel,))
  self.c.execute("""CREATE FUNCTION public.tracker_test_auto_channel() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN
   INSERT INTO public.team_chat_conversation_members(conversation_id,user_id,role) SELECT id,NEW.id,'member' FROM public.team_chat_conversations WHERE kind='channel';RETURN NEW;END$f$;
   CREATE TRIGGER tracker_test_auto_channel AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tracker_test_auto_channel();
   CREATE FUNCTION public.tracker_test_profile_guard() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role AND NOT(NEW.role='admin' AND OLD.role='viewer' AND EXISTS(SELECT FROM auth.users u JOIN public.admin_emails a ON lower(a.email)=lower(u.email) WHERE u.id=NEW.id)) THEN RAISE EXCEPTION 'Role cannot be changed by client update';END IF;RETURN NEW;END$f$;
   CREATE TRIGGER tracker_test_profile_guard BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tracker_test_profile_guard();""")
 def tearDown(self):self.original.tearDown()
 def create(self,bind=True):return self.original.create(bind)
 def test_allowlist_first_with_real_guard_then_exact_membership_cleanup(self):
  state=self.create();self.assertEqual([len(a['auto_channel_memberships']) for a in state['actors']],[1,1])
  self.assertEqual(self.c.execute('SELECT role FROM public.profiles WHERE id=%s',(state['actors'][0]['id'],)).fetchone(),('admin',))
  result=fixture.cleanup(self.c,state);self.assertEqual(result['removed_owned_channel_memberships'],2)
  self.assertEqual(self.c.execute('SELECT count(*) FROM public.team_chat_conversations').fetchone()[0],1)
 def test_unrelated_channel_member_retained_byte_for_byte(self):
  foreign=uuid.uuid4();self.c.execute("INSERT INTO auth.users(id,role,email)VALUES(%s,'authenticated','foreign-chat@example.invalid')",(foreign,));self.c.execute("INSERT INTO public.profiles(id,role)VALUES(%s,'viewer')",(foreign,))
  before=self.c.execute('SELECT to_jsonb(m) FROM public.team_chat_conversation_members m WHERE user_id=%s',(foreign,)).fetchone()[0]
  state=self.create();self.assertEqual(fixture.cleanup(self.c,state)['removed_owned_channel_memberships'],2)
  self.assertEqual(self.c.execute('SELECT to_jsonb(m) FROM public.team_chat_conversation_members m WHERE user_id=%s',(foreign,)).fetchone()[0],before)
 def test_unknown_create_response_proves_original_triple_xmin(self):
  state=self.create(False);result=fixture.cleanup(self.c,state);self.assertEqual(result['removed_owned_channel_memberships'],2)
 def test_modified_unread_or_later_membership_refused(self):
  state=self.create()
  with self.c.transaction():self.c.execute('UPDATE public.team_chat_conversation_members SET last_read_at=now() WHERE user_id=%s',(state['actors'][0]['id'],))
  with self.assertRaisesRegex(AssertionError,'read state'),self.c.transaction():fixture.cleanup(self.c,state)
 def test_extra_membership_not_in_initial_receipt_refused(self):
  state=self.create();extra=uuid.uuid4();self.c.execute("INSERT INTO public.team_chat_conversations VALUES(%s,'channel')",(extra,))
  self.c.execute('INSERT INTO public.team_chat_conversation_members(conversation_id,user_id)VALUES(%s,%s)',(extra,state['actors'][0]['id']))
  with self.assertRaisesRegex(AssertionError,'extra row'),self.c.transaction():fixture.cleanup(self.c,state)
 def test_unbound_later_xmin_cannot_be_adopted(self):
  state=self.create(False)
  with self.c.transaction():self.c.execute("UPDATE public.team_chat_conversation_members SET joined_at=joined_at+interval '1 second'")
  with self.assertRaisesRegex(AssertionError,'original Auth/profile insert'),self.c.transaction():fixture.cleanup(self.c,state)
 def test_foreign_children_block_membership_deletion(self):
  state=self.create();self.c.execute('CREATE TABLE public.tracker_test_member_child(conversation_id uuid,user_id uuid,FOREIGN KEY(conversation_id,user_id)REFERENCES public.team_chat_conversation_members ON DELETE CASCADE)')
  self.c.execute('INSERT INTO public.tracker_test_member_child VALUES(%s,%s)',(self.channel,state['actors'][0]['id']))
  with self.assertRaisesRegex(AssertionError,'child relationships'),self.c.transaction():fixture.cleanup(self.c,state)
 def test_bind_rollback_retains_original_membership_receipt(self):
  state=self.create(False)
  try:
   with self.c.transaction():
    a=state['actors'][0];id=self.c.execute('SELECT id FROM auth.users WHERE email=%s',(a['email'],)).fetchone()[0];fixture.bind(self.c,state,a,id);raise ValueError('rollback')
  except ValueError:pass
  self.assertEqual(fixture.cleanup(self.c,state)['removed_owned_channel_memberships'],2)
if __name__=='__main__':unittest.main()
