"""Staging-only transaction regression: atomic media mapping replacement and rollback.
The existing refresh must be idle. No source or Storage objects are changed.
"""
import base64,json,psycopg,tempfile
from psycopg.types.json import Jsonb
from pathlib import Path
from database import connect
from snapshot import require
from media_sync import publish,backup_state,prepare_restore

def main():
 with connect('staging') as c:
  require(c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'A refresh is running')
  before=c.execute("SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY resource,record_id,field,pointer),'[]')::text) FROM sa_media.references r").fetchone()[0]
  with tempfile.TemporaryDirectory() as folder:
   backup_state(c,folder)
   # Verify a small authentic recovery manifest without downloading the full corpus
   # in a transaction. Full backup recovery uses the same routine over all objects.
   saved=json.loads(Path(folder,'media-state.json').read_text());ready=next(r for r in saved['references'] if r['status']=='ready')
   selected={**saved,'references':[ready],'objects':[o for o in saved['objects'] if o['sha256']==ready['sha256']]}
   Path(folder,'media-state.json').write_text(json.dumps(selected))
   prepared=prepare_restore(c,folder,'staging')
   try:
    with c.transaction():
     publish(c,prepared)
     assert c.execute('SELECT count(*) FROM sa_media.references').fetchone()[0]==1
     raise RuntimeError('forced failure before commit')
   except RuntimeError as e:assert str(e)=='forced failure before commit'
   after=c.execute("SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY resource,record_id,field,pointer),'[]')::text) FROM sa_media.references r").fetchone()[0]
   assert before==after
   state=json.loads(Path(__file__).with_name('private').joinpath('browser-state.json').read_text())
   session=next(json.loads(v) for k,v in state['local'].items() if k.endswith('-auth-token'))
   encoded=session['access_token'].split('.')[1]
   claims=json.loads(base64.urlsafe_b64decode(encoded+'='*(-len(encoded)%4)))
   category=c.execute("SELECT record_id FROM sa_media.references WHERE resource='rmp_categories' AND status='ready' LIMIT 1").fetchone()[0]
   try:
    with c.transaction():
     c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps(claims),))
     c.execute('SET LOCAL ROLE authenticated')
     original=c.execute("SELECT canto_api.masters('rmp_categories','get',%s)",(Jsonb({'id':str(category)}),)).fetchone()[0]
     updated=c.execute("SELECT canto_api.masters('rmp_categories','update',%s)",(Jsonb({'id':str(category),'values':{'name':original['name']},'expectedUpdatedAt':original['updated_at']}),)).fetchone()[0]
     assert updated['image']==original['image'] and updated['image'].startswith('canto-media://')
     raise RuntimeError('rollback media edit acceptance')
   except RuntimeError as e:assert str(e)=='rollback media edit acceptance'
   for role in ['anon','sa_app']:
    try:
     with c.transaction():
      c.execute('SET LOCAL ROLE '+role);c.execute('SELECT canto_api.media_status()')
    except psycopg.errors.InsufficientPrivilege:pass
    else:raise AssertionError('Media status exposed')
   print(json.dumps({'mapping_rollback_preserved':True,'recovery_object_checksum_verified':True,'ordinary_master_edit_preserves_media':True,'anonymous_and_customer_roles_denied':True}))
if __name__=='__main__':main()
