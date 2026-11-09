import unittest
import psycopg
from psycopg.types.json import Jsonb
import test_account_flows as base

class RegistrationProfileControls(unittest.TestCase):
 @classmethod
 def setUpClass(cls):base.AccountFlows.setUpClass()
 def setUp(self):self.f=base.AccountFlows();self.f.setUp();self.c=self.f.c
 def tearDown(self):self.f.tearDown()
 def test_single_name_and_optional_gst_survive_verified_unapproved_registration(self):
  profile=dict(self.f.profile(),last_name='',gst_no='TEST-GST-ONLY')
  request=self.f.request('register','single-name@example.invalid',profile)
  self.assertEqual(self.f.raw("SELECT count(*) FROM sa_snapshot_20261019.sa_users WHERE email='single-name@example.invalid'"),[(0,)])
  prepared=self.f.prepare(request['request_id'],email='single-name@example.invalid');self.f.provider(prepared,True);result=self.f.finish(prepared)
  self.assertEqual(result['next'],'await_approval')
  self.assertEqual(self.f.raw('SELECT name,customer_last_name,gst_no,role,approved,onboarded FROM sa_snapshot_20261019.sa_users WHERE id=%s',(int(prepared['legacy_user_id']),)),[('First','','TEST-GST-ONLY',3,False,False)])
 def test_empty_optional_last_name_and_gst_accepted(self):
  self.f.request('register','empty-optional@example.invalid',dict(self.f.profile(),last_name='',gst_no=''))
 def test_phone_requires_exact_ten_digits(self):
  for value in ['123456789','12345678901','12345abc90','１２３４５６７８９０','123456789 ',None]:
   with self.subTest(value=value),self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():
    self.f.request('register','invalid@example.invalid',dict(self.f.profile(),phone=value))
 def test_null_last_name_and_blank_required_fields_rejected(self):
  for field,value in [('last_name',None),('first_name',' '),('company_name','')]:
   with self.subTest(field=field),self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():
    self.f.request('register','invalid@example.invalid',dict(self.f.profile(),**{field:value}))
 def test_optional_fields_do_not_expand_guest_privileges(self):
  for field in ['role','approved','rmp_price_type_id','features']:
   with self.subTest(field=field),self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():
    self.f.request('register','invalid@example.invalid',dict(self.f.profile(),last_name='',**{field:True}))
if __name__=='__main__':unittest.main()
