"""Exercise only rollback-created orders; invoked by the hosted acceptance journey."""
import decimal,uuid

def exercise(c,order,checks):
 id_=int(order['id']);v=order['version']
 r=c.execute('SELECT canto_api.v1_order_priority_save(%s,true,%s,%s,%s)',(id_,'Rollback priority',v,uuid.uuid4())).fetchone()[0]
 assert r['is_prime'];v=r['version']
 r=c.execute('SELECT canto_api.v1_order_due_save(%s,%s,%s,%s,%s)',(id_,'2026-12-02T10:30:00+05:30','Rollback due date',v,uuid.uuid4())).fetchone()[0];v=r['version']
 key=uuid.uuid4();args=(id_,'paid',decimal.Decimal(order['total_amount']),'Rollback settlement',v,key)
 r=c.execute('SELECT canto_api.v1_order_payment_record(%s,%s,%s,%s,%s,%s)',args).fetchone()[0]
 assert r==c.execute('SELECT canto_api.v1_order_payment_record(%s,%s,%s,%s,%s,%s)',args).fetchone()[0]
 assert r['payment_status']==0;v=r['version'];checks.append('priority, due date and payment settlement with exact retry')
 r=c.execute('SELECT canto_api.v1_order_cancel(%s,%s,%s,%s,%s)',(id_,'cancel','Rollback cancellation',v,uuid.uuid4())).fetchone()[0]
 assert r['state']=='cancelled'
 detail=c.execute('SELECT canto_api.v1_order_get(%s)',(id_,)).fetchone()[0]
 assert detail['provider_status']=='CANCELLED' and detail['status']==0 and not detail['force_completed']
 assert detail['items']['data'];checks.append('custom cancellation preserves items and cannot look completed')
