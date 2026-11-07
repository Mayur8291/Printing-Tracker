import datetime,decimal,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue
from test_pricing import custom,rmp
D=decimal.Decimal
class QuoteOverrides(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  self.c.execute("UPDATE sa_snapshot_20261019.sa_addresses SET state='Karnataka' WHERE id=100");session(self.c,101)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def quote(self):return rpc(self.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[custom(),rmp()]}),))
 def override(self,q,price='90',line=1,key=None):return rpc(self.c,'v1_quote_override',(uuid.UUID(q['quote_id']),line,D(price),'Approved commercial adjustment',q['version'],key or uuid.uuid4()))
 def test_override_recomputes_line_and_order_tax(self):
  q=self.quote();changed=self.override(q);self.assertNotEqual(changed['version'],q['version'])
  line=changed['lines'][0];self.assertEqual(D(line['variants'][0]['unit_price']),90);self.assertEqual(D(line['variants'][0]['calculated_unit_price']),D('191.400'))
  self.assertEqual(D(line['subtotal']),540);self.assertEqual(D(line['cgst']),D('13.50'));self.assertEqual(D(changed['total']),1071)
 def test_override_rmp_recomputes_sku_rates(self):
  q=self.quote();changed=self.override(q,price='50',line=2);self.assertEqual(D(changed['lines'][1]['subtotal']),300);self.assertEqual(D(changed['lines'][1]['cgst']),D('7.50'))
 def test_retry_is_exact_and_audited_once(self):
  q=self.quote();key=uuid.uuid4();changed=self.override(q,key=key);self.assertEqual(changed,self.override(q,key=key))
  self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.audit WHERE command_key=%s',(key,)).fetchone()[0],1)
 def test_stale_version_rejected(self):
  q=self.quote();self.override(q)
  with self.assertRaises(psycopg.errors.SerializationFailure):self.override(q,price='91')
 def test_customer_cannot_override(self):
  q=self.quote();self.c.execute('RESET ROLE');session(self.c,103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.override(q)
 def test_other_sc_cannot_override_foreign_quote(self):
  q=self.quote();self.c.execute('RESET ROLE');session(self.c,201)
  with self.assertRaises(psycopg.errors.NoDataFound):self.override(q)
 def test_expired_quote_rejected(self):
  q=self.quote();self.c.execute('RESET ROLE');self.c.execute("UPDATE sa_domain.quotes SET expires_at=now()-interval '1 second'");session(self.c,101)
  with self.assertRaises(psycopg.errors.SerializationFailure):self.override(q)
 def test_master_price_change_invalidates_override(self):
  q=self.quote();self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_snapshot_20261019.sa_fabrics SET price=51 WHERE id=1');session(self.c,101)
  with self.assertRaises(psycopg.errors.SerializationFailure):self.override(q)
 def test_generation_invalidates_quote(self):
  q=self.quote();self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_domain.runtime_state SET generation=generation+1');session(self.c,101)
  with self.assertRaises(psycopg.errors.SerializationFailure):self.override(q)
 def test_invalid_line_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.override(self.quote(),line=3)
 def test_negative_override_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.override(self.quote(),price='-1')
 def test_nonfinite_override_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.override(self.quote(),price='NaN')
 def test_reason_required(self):
  q=self.quote()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_quote_override',(uuid.UUID(q['quote_id']),1,D(90),'',q['version'],uuid.uuid4()))
if __name__=='__main__':unittest.main(verbosity=2)
