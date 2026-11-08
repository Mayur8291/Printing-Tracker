"""Hosted rollback fixtures must also undo generated IDs after a disconnect."""
import unittest,uuid
from psycopg import sql
from local_db import connect

class SequenceIsolation(unittest.TestCase):
 def setUp(self):
  self.name='probe_'+uuid.uuid4().hex;self.relation=sql.Identifier('sa_domain',self.name)
  with connect() as c:c.execute(sql.SQL('CREATE SEQUENCE {} START 42').format(self.relation))
 def tearDown(self):
  with connect() as c:c.execute(sql.SQL('DROP SEQUENCE {}').format(self.relation))
 def state(self):
  with connect() as c:return c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(self.relation)).fetchone()
 def advance(self,c):
  c.execute('BEGIN');c.execute(sql.SQL('ALTER SEQUENCE {} RESTART WITH 42').format(self.relation))
  c.execute('SELECT nextval(%s::regclass)',('sa_domain.'+self.name,))
 def test_explicit_rollback_restores_sequence(self):
  before=self.state()
  with connect() as c:self.advance(c);c.execute('ROLLBACK')
  self.assertEqual(self.state(),before)
 def test_disconnect_restores_sequence(self):
  before=self.state();c=connect();self.advance(c);c.close();self.assertEqual(self.state(),before)
