"""Real staging role/assignment journey; every write belongs to the outer rollback."""
import decimal,json,uuid

def exercise(c,order,checks,execution=False):
 c.execute('SET LOCAL ROLE postgres')
 actors=c.execute("""SELECT DISTINCT ON(u.role) u.role,u.id,m.auth_user_id,u.factory_id FROM sa_snapshot_20261019.sa_users u
 JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready'
 WHERE u.role IN(2,11) AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE ORDER BY u.role,u.id""").fetchall()
 actors={r[0]:r[1:] for r in actors}
 factory=c.execute("""SELECT fm.id,m.auth_user_id,cm.id,n.auth_user_id FROM sa_snapshot_20261019.sa_users fm
 JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=fm.id AND m.enrollment_state='ready'
 JOIN sa_snapshot_20261019.sa_users cm ON cm.role=9 AND cm.factory_manager_id=fm.id AND cm.deleted_at IS NULL AND cm.disabled IS NOT TRUE
 JOIN sa_identity.sa_auth_identities n ON n.legacy_user_id=cm.id AND n.enrollment_state='ready'
 WHERE fm.role=4 AND fm.factory_id IS NOT NULL
 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_users t WHERE t.factory_manager_id=fm.id AND t.role=5 AND t.disabled IS NOT TRUE AND t.deleted_at IS NULL)
 AND (SELECT count(DISTINCT t.role) FROM sa_snapshot_20261019.sa_users t JOIN sa_identity.sa_auth_identities tm ON tm.legacy_user_id=t.id AND tm.enrollment_state='ready' WHERE t.factory_manager_id=fm.id AND t.role IN(7,8) AND t.disabled IS NOT TRUE AND t.deleted_at IS NULL)=2 AND fm.deleted_at IS NULL AND fm.disabled IS NOT TRUE ORDER BY fm.id,cm.id LIMIT 1""").fetchone()
 assert 2 in actors and 11 in actors and factory,'Eligible PC, job worker, factory manager and cutter required'
 actor_ids={2:actors[2][1],11:actors[11][1],4:factory[1],9:factory[3]};sessions={}
 for role,auth_id in actor_ids.items():
  sid=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,auth_id));sessions[role]=sid
  c.execute('UPDATE sa_domain.runtime_state SET test_actor_ids=array_append(test_actor_ids,%s) WHERE NOT %s=ANY(test_actor_ids)',(auth_id,auth_id))
 def actor(role):
  c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(actor_ids[role]),'session_id':str(sessions[role])}),));c.execute('SET LOCAL ROLE sa_app')
 def version(kind,id_):
  c.execute('SET LOCAL ROLE postgres');v=c.execute('SELECT sa_domain.version(%s,%s)',(kind,id_)).fetchone()[0];return v
 id_=int(order['id']);item=int(order['items'][0]['item_id'])
 actor(2)
 r=c.execute('SELECT canto_api.v1_order_assign_factory(%s,%s,%s,%s,%s)',(id_,factory[0],'Rollback allocation',order['version'],uuid.uuid4())).fetchone()[0]
 assert r['manager_id']==str(factory[0]);checks.append('PC assigns factory with one production authority')
 v=version('item',item);actor(4)
 r=c.execute('SELECT canto_api.v1_item_assign_cutter(%s,%s,%s,%s,%s)',(item,factory[2],'Rollback cutting assignment',v,uuid.uuid4())).fetchone()[0]
 assert r['cutter_id']==str(factory[2]);checks.append('FM assigns eligible cutter in same factory')
 c.execute('SET LOCAL ROLE postgres');criteria=[{'id':str(x[0]),'checked':True} for x in c.execute('SELECT id FROM sa_snapshot_20261019.sa_item_criteria WHERE item_id=%s',(item,))]
 v=version('item',item);actor(4)
 r=c.execute('SELECT canto_api.v1_item_criteria_save(%s,%s,%s,%s)',(item,json.dumps(criteria),v,uuid.uuid4())).fetchone()[0]
 assert r['criteria_complete'];actor(9)
 progress=c.execute('SELECT canto_api.v1_production_progress(%s)',(id_,)).fetchone()[0]
 assert progress['criteria_complete'];checks.append('checklist completion and assigned cutter progress')
 if execution:
  from hosted_factory_execution import exercise as execute_factory
  execute_factory(c,order,checks,actor,version,factory);return
 v=version('order',id_);actor(2)
 r=c.execute('SELECT canto_api.v1_order_assign_worker(%s,%s,%s,%s,%s,%s)',(id_,actors[11][0],'2026-12-01T00:00:00Z','Rollback job work',v,uuid.uuid4())).fetchone()[0]
 v=version('item',item);actor(2)
 r=c.execute('SELECT canto_api.v1_worker_cost_save(%s,%s,%s,%s,%s)',(item,decimal.Decimal('12.35'),'Rollback rate',v,uuid.uuid4())).fetchone()[0]
 assert decimal.Decimal(r['total_cost'])==decimal.Decimal('74.10');checks.append('reassignment before work and derived worker cost')
 v=version('order',id_);actor(11)
 r=c.execute('SELECT canto_api.v1_worker_due_save(%s,%s,%s,%s,%s)',(id_,'2026-12-03T00:00:00Z','Rollback due change',v,uuid.uuid4())).fetchone()[0]
 assert r['delta_days']==2 and r['baseline_basis']=='assignment'
 for stage in range(1,6):
  v=version('item',item);actor(11)
  r=c.execute('SELECT canto_api.v1_worker_stage_save(%s,%s,%s,%s,%s)',(item,stage,'Rollback progress',v,uuid.uuid4())).fetchone()[0]
 assert r['order_completed'];checks.append('JW due baseline and five advances to dispatched complete custom work')
