"""Disposable Tracker identities for read-only gateway acceptance.
No source identity, business-write lease, cron change, or existing staff edit.
The integration wrapper owns actual GoTrue create/login; these SQL helpers
bind and remove only newly-created run-marked Auth/profile rows.
"""
import uuid
from psycopg import sql
URL='https://scvojtvgnkmbupvyslmb.supabase.co'
FORMAT='tracker-read-staff/v1'
AUTH_HASH="encode(sha256(convert_to((to_jsonb(u)-'updated_at'-'last_sign_in_at')::text,'UTF8')),'hex')"
ROW_HASH="encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex')"
def validate(state):
 assert state.get('format')==FORMAT and state.get('url')==URL and state.get('environment')=='staging'
 run=uuid.UUID(state['run_id']);assert state['label']=='tracker-read-'+run.hex
 assert [a['role'] for a in state['actors']]==['admin','viewer']
 for a in state['actors']:
  assert a['email']==state['label']+'-'+a['role']+'@example.invalid'
  assert a['name']=='Tracker read '+run.hex[:12]+' '+a['role']
  if a.get('id'):assert str(uuid.UUID(a['id']))==a['id']
 return state

def environment(c):
 return c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()

def plan(c):
 env=environment(c);assert env[:3]==('staging',False,None) and env[3]==env[4]
 assert c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone()==(False,[],None)
 run=uuid.uuid4();state={'format':FORMAT,'environment':'staging','url':URL,'run_id':str(run),'label':'tracker-read-'+run.hex,'environment_before':list(env),'created_at':c.execute('SELECT clock_timestamp()').fetchone()[0].isoformat(),'actors':[]}
 for role in ['admin','viewer']:
  a={'role':role,'email':state['label']+'-'+role+'@example.invalid','name':'Tracker read '+run.hex[:12]+' '+role,'id':None}
  assert not c.execute('SELECT 1 FROM auth.users WHERE lower(email)=%s',(a['email'],)).fetchone()
  assert not c.execute('SELECT 1 FROM public.admin_emails WHERE lower(email)=%s',(a['email'],)).fetchone()
  assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE lower(email)=%s',(a['email'],)).fetchone()
  state['actors'].append(a)
 return validate(state)

def locate(c,state,a,lock=False):
 validate(state)
 row=c.execute('SELECT id,email,role,raw_user_meta_data,created_at,raw_app_meta_data FROM auth.users WHERE lower(email)=%s'+(' FOR UPDATE' if lock else ''),(a['email'],)).fetchone()
 if not row:return None
 if a.get('id'):assert str(row[0])==a['id'],'Fixture Auth UUID changed'
 assert row[1:3]==(a['email'],'authenticated')
 assert (row[5] or {}).get('tracker_read_run')==state['run_id'],'Fixture trusted run marker changed'
 assert row[3].get('tracker_read_run')==state['run_id'] and row[3].get('full_name')==a['name'],'Fixture metadata changed'
 assert c.execute('SELECT %s::timestamptz >= %s::timestamptz',(row[4],state['created_at'])).fetchone()[0],'Preexisting identity cannot be owned'
 assert not c.execute('SELECT 1 FROM sa_identity.sa_auth_identities WHERE auth_user_id=%s',(row[0],)).fetchone(),'Staff fixture became a source identity'
 return row[0]

def channel_memberships(c,a,*,capture=False):
 """Only unread channel membership created in the original Auth INSERT is owned.
 A persisted receipt is mandatory after promotion/login changes parent xmins.
 Unknown-create recovery instead proves the still-untouched triple-xmin match.
 """
 if not c.execute("SELECT to_regclass('public.team_chat_conversation_members')").fetchone()[0]:
  assert not a.get('auto_channel_memberships');return []
 assert not c.execute("SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid='public.team_chat_conversation_members'::regclass LIMIT 1").fetchone(),'Membership has child relationships requiring review'
 rows=c.execute("""SELECT m.conversation_id::text,m.user_id::text,m.xmin::text,
  encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex'),
  cc.kind,m.role,m.last_read_at IS NULL,m.xmin::text=p.xmin::text,m.xmin::text=u.xmin::text
  FROM public.team_chat_conversation_members m JOIN public.profiles p ON p.id=m.user_id
  JOIN auth.users u ON u.id=p.id JOIN public.team_chat_conversations cc ON cc.id=m.conversation_id
  WHERE m.user_id=%s ORDER BY m.conversation_id FOR UPDATE OF m""",(a['id'],)).fetchall()
 assert all(r[4:7]==('channel','member',True) for r in rows),'Fixture channel membership changed purpose, role or read state'
 receipts=[{'conversation_id':r[0],'user_id':r[1],'xmin':r[2],'sha256':r[3]} for r in rows]
 if capture or 'auto_channel_memberships' not in a:
  assert all(r[7] and r[8] for r in rows),'Membership is not from the exact original Auth/profile insert'
  if capture:a['auto_channel_memberships']=receipts
 else:assert receipts==a['auto_channel_memberships'],'Fixture channel membership receipt changed or extra row appeared'
 return receipts

def bind(c,state,a,auth_id):
 """Called immediately after own GoTrue creation, before exposing any session."""
 validate(state);assert a['id'] is None or a['id']==str(auth_id);a['id']=str(uuid.UUID(str(auth_id)))
 assert locate(c,state,a,True)==uuid.UUID(a['id'])
 profile=c.execute('SELECT id FROM public.profiles WHERE id=%s FOR UPDATE',(a['id'],)).fetchone();assert profile,'Expected GoTrue profile trigger'
 channel_memberships(c,a,capture=True)
 a['before_bind']={'auth':c.execute('SELECT '+AUTH_HASH+' FROM auth.users u WHERE id=%s',(a['id'],)).fetchone()[0],'profile':c.execute('SELECT '+ROW_HASH+' FROM public.profiles p WHERE id=%s',(a['id'],)).fetchone()[0]}
 assert not c.execute('SELECT 1 FROM public.admin_emails WHERE email=%s',(a['email'],)).fetchone()
 if a['role']=='admin':
  assert not c.execute('SELECT 1 FROM public.admin_emails WHERE email=%s',(a['email'],)).fetchone()
  c.execute('INSERT INTO public.admin_emails(email) VALUES(%s)',(a['email'],))
  # Existing profile guard permits viewer→admin only after this exact email is allowlisted.
  c.execute("UPDATE public.profiles SET role='admin' WHERE id=%s AND role='viewer'",(a['id'],))
 else:assert c.execute('SELECT role FROM public.profiles WHERE id=%s',(a['id'],)).fetchone()==('viewer',)
 a['auth_fingerprint']=c.execute('SELECT '+AUTH_HASH+' FROM auth.users u WHERE id=%s',(a['id'],)).fetchone()[0]
 a['profile_fingerprint']=c.execute('SELECT '+ROW_HASH+' FROM public.profiles p WHERE id=%s',(a['id'],)).fetchone()[0]
 a['allowlist_fingerprint']=c.execute('SELECT '+ROW_HASH+' FROM public.admin_emails p WHERE email=%s',(a['email'],)).fetchone()
 if a['allowlist_fingerprint']:a['allowlist_fingerprint']=a['allowlist_fingerprint'][0]
 return a

def unrelated(c,ids,emails=()):
 return tuple(c.execute("SELECT encode(sha256(convert_to(coalesce(string_agg(h,',' ORDER BY id),''),'UTF8')),'hex') FROM(SELECT id::text,md5(to_jsonb(t)::text) h FROM "+table+" t WHERE NOT(id=ANY(%s::uuid[]))) s",(ids,)).fetchone()[0] for table in ['auth.users','public.profiles']) + (c.execute("SELECT encode(sha256(convert_to(coalesce(string_agg(md5(to_jsonb(p)::text),',' ORDER BY email),''),'UTF8')),'hex') FROM public.admin_emails p WHERE email<>ALL(%s::text[])",(list(emails),)).fetchone()[0],)

def references(c,ids,sessions):
 """Any unexpected dependent row prevents deletion, even if its FK cascades."""
 allowed={('public','profiles','id','auth.users'),('public','team_chat_conversation_members','user_id','public.profiles'),('auth','identities','user_id','auth.users'),('auth','sessions','user_id','auth.users'),('auth','refresh_tokens','session_id','auth.sessions'),('auth','mfa_amr_claims','session_id','auth.sessions')}
 rows=c.execute("""SELECT ns.nspname,t.relname,a.attname,pns.nspname||'.'||parent.relname,cardinality(k.conkey),cardinality(k.confkey)
 FROM pg_constraint k JOIN pg_class t ON t.oid=k.conrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.conkey[1]
 JOIN pg_class parent ON parent.oid=k.confrelid JOIN pg_namespace pns ON pns.oid=parent.relnamespace
 WHERE k.contype='f' AND k.confrelid IN('auth.users'::regclass,'public.profiles'::regclass,'auth.sessions'::regclass)""").fetchall()
 for ns,table,col,parent,n,m in rows:
  assert n==m==1,'Unexpected compound reference requires review'
  targets=sessions if parent=='auth.sessions' else ids
  if not targets:continue
  found=c.execute(sql.SQL('SELECT 1 FROM {}.{} WHERE {}=ANY(%s::uuid[]) LIMIT 1').format(sql.Identifier(ns),sql.Identifier(table),sql.Identifier(col)),(targets,)).fetchone()
  assert not found or (ns,table,col,parent) in allowed,'Unexpected row references disposable staff; preserving it'
 if sessions:
  assert not c.execute('SELECT 1 FROM auth.refresh_tokens WHERE session_id=ANY(%s::uuid[]) AND user_id<>ALL(%s::text[])',(sessions,list(map(str,ids)))).fetchone(),'Foreign refresh token references fixture session'
 assert not c.execute('SELECT 1 FROM auth.refresh_tokens WHERE user_id=ANY(%s::text[]) AND(session_id IS NULL OR NOT(session_id=ANY(%s::uuid[])))',(list(map(str,ids)),sessions)).fetchone(),'Unbound fixture refresh token'

def cleanup(c,state):
 validate(state)
 with c.transaction():
  environment_at_cleanup=list(environment(c));assert environment_at_cleanup[:3]==state['environment_before'][:3],'Refresh/ownership changed; preserve fixture for review'
  ids=[];memberships=[]
  for a in state['actors']:
   actual=locate(c,state,a,True)
   if actual is None:
    if a.get('id'):
     assert not c.execute('SELECT 1 FROM auth.users WHERE id=%s',(a['id'],)).fetchone(),'Fixture UUID changed email'
     assert not c.execute('SELECT 1 FROM public.profiles WHERE id=%s',(a['id'],)).fetchone(),'Absent Auth retained profile; preserve for review'
    assert not c.execute('SELECT 1 FROM public.admin_emails WHERE email=%s',(a['email'],)).fetchone(),'Absent Auth retained allowlist; preserve for review'
    continue
   auth=c.execute('SELECT '+AUTH_HASH+' FROM auth.users u WHERE id=%s',(actual,)).fetchone()[0]
   profile=c.execute('SELECT '+ROW_HASH+' FROM public.profiles p WHERE id=%s FOR UPDATE',(actual,)).fetchone()
   allow=c.execute('SELECT '+ROW_HASH+' FROM public.admin_emails p WHERE email=%s FOR UPDATE',(a['email'],)).fetchone()
   if a.get('auth_fingerprint'):
    current=(auth,profile,allow)
    bound=(a['auth_fingerprint'],(a['profile_fingerprint'],),(a['allowlist_fingerprint'],) if a['allowlist_fingerprint'] else None)
    before=a.get('before_bind',{})
    uncommitted=(before.get('auth'),(before.get('profile'),),None)
    assert current in [bound,uncommitted],'Fixture credential, profile changed or allowlist changed'
   else:
    assert not allow,'Unbound fixture unexpectedly has administrator allowlist entry'
   # Unknown create can have no UUID in the disk checkpoint; locate already
   # proved trusted run ownership before using this temporary local binding.
   owned_actor={**a,'id':str(actual)}
   memberships.extend(channel_memberships(c,owned_actor))
   ids.append(actual)
  owned_emails=[a[0] for a in c.execute('SELECT email FROM auth.users WHERE id=ANY(%s::uuid[])',(ids,))]
  before=unrelated(c,ids,owned_emails)
  sessions=[r[0] for r in c.execute('SELECT id FROM auth.sessions WHERE user_id=ANY(%s::uuid[]) FOR UPDATE',(ids,))];references(c,ids,sessions)
  if c.execute("SELECT to_regclass('auth.mfa_amr_claims')").fetchone()[0]:c.execute('DELETE FROM auth.mfa_amr_claims WHERE session_id=ANY(%s::uuid[])',(sessions,))
  c.execute('DELETE FROM auth.refresh_tokens WHERE user_id=ANY(%s::text[])',(list(map(str,ids)),));c.execute('DELETE FROM auth.sessions WHERE user_id=ANY(%s::uuid[])',(ids,))
  if c.execute("SELECT to_regclass('auth.identities')").fetchone()[0]:c.execute('DELETE FROM auth.identities WHERE user_id=ANY(%s::uuid[])',(ids,))
  # Revalidate the exact complete set immediately before deleting those rows.
  current=[]
  for a in state['actors']:
   actual=next((id for id in ids if str(id)==a.get('id')),None)
   if actual is None:
    actual=c.execute('SELECT id FROM auth.users WHERE lower(email)=%s',(a['email'],)).fetchone()
    actual=actual[0] if actual else None
   if actual in ids:current.extend(channel_memberships(c,{**a,'id':str(actual)}))
  assert current==memberships,'Channel membership set changed before deletion'
  for member in memberships:
   removed=c.execute("DELETE FROM public.team_chat_conversation_members m WHERE conversation_id=%s AND user_id=%s AND xmin::text=%s AND encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')=%s RETURNING user_id",(member['conversation_id'],member['user_id'],member['xmin'],member['sha256'])).fetchall()
   assert len(removed)==1,'Exact owned channel membership changed before deletion'
  c.execute('DELETE FROM public.profiles WHERE id=ANY(%s::uuid[])',(ids,))
  for a in state['actors']:
   if a['email'] in owned_emails:c.execute('DELETE FROM public.admin_emails WHERE email=%s',(a['email'],))
  c.execute('DELETE FROM auth.users WHERE id=ANY(%s::uuid[])',(ids,))
  assert unrelated(c,[])==before,'Unrelated Auth/profile changed during cleanup; preserving transaction'
  assert list(environment(c))==environment_at_cleanup,'Business environment changed during cleanup'
 return {'removed_owned_auth':len(ids),'removed_owned_channel_memberships':len(memberships),'unrelated_auth_profiles_preserved_during_cleanup':True,'business_revision_unchanged':environment_at_cleanup==state['environment_before'],'no_source_identity_or_write_lease':True}
