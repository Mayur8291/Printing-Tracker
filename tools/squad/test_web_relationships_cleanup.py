"""Exact-owned relationship follow-up graph: local SQL, no hosted execution."""
import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
import test_web_people_cleanup as people

class RelationshipCleanup(unittest.TestCase):
 setUpClass=classmethod(people.PeopleCleanup.setUpClass.__func__)
 setUp=people.PeopleCleanup.setUp;tearDown=people.PeopleCleanup.tearDown
 prepare=people.PeopleCleanup.prepare;actor=people.PeopleCleanup.actor;clean=people.PeopleCleanup.clean
 def command(self,actor,name,args,label):
  self.actor(actor);key=uuid.uuid5(uuid.UUID(self.state['run_id']),'web.links.'+label)
  self.entries.append({'kind':'command','value':{'label':'web.links.'+label,'key':str(key)}})
  values=(*args,key);result=self.c.execute('SELECT canto_api.'+name+'('+','.join(['%s']*len(values))+')',values).fetchone()[0]
  self.c.execute('RESET ROLE');return result
 def person(self,actor,id):
  self.actor(actor);result=self.c.execute('SELECT canto_api.v1_person_get(%s)',(id,)).fetchone()[0];self.c.execute('RESET ROLE');return result
 def test_isolated_dealer_brand_rules_customer_links_transfer_and_cleanup(self):
  self.prepare();created={};reason=self.state['label']+' isolated links'
  for actor,role in [(0,10),(1,3)]:
   fields={'name':reason+str(role),'phone':'9000000000','email':'squad-links-'+self.state['run_id'].replace('-','')+'-'+str(role)+'@mailinator.com'}
   r=self.command(actor,'v1_person_save',(None,role,Jsonb(fields),None),'create'+str(role));created[role]=int(r['id']);self.entries.append({'kind':'entity','value':{'kind':'person','id':r['id']}})
   self.command(actor,'v1_customer_review',(created[role],Jsonb({'approved':True,'onboarded':True}),reason,r['version']),'review'+str(role))
  dealer,customer=created[10],created[3];brand=str(self.state['data_base']+100);price=str(self.state['data_base']+107)
  self.command(0,'v1_customer_commercial_rules_save',(dealer,Jsonb({'brand_ids':[brand],'price_type_id':price,'stock_visibility_percentage':60}),reason,self.person(0,dealer)['version']),'dealer-commercial')
  self.command(0,'v1_dealer_rules_save',(dealer,Jsonb({'auto_approve_customers':True,'zone_id':None}),reason,self.person(0,dealer)['version']),'dealer-rules')
  p=self.person(0,dealer);self.assertEqual(p['brand_ids'],[brand]);self.assertTrue(p['auto_approve_customers'])
  self.command(1,'v1_customer_commercial_rules_save',(customer,Jsonb({'price_type_id':price,'stock_visibility_percentage':35}),reason,self.person(1,customer)['version']),'customer-commercial')
  for suffix,coordinator in [('link',self.state['base']+1),('transfer',self.state['data_base']+120),('restore',self.state['base']+1)]:
   self.command(0,'v1_customer_links_save',(customer,coordinator,[dealer],False,reason,self.person(0,customer)['version']),suffix)
   p=self.person(0,customer);self.assertEqual(p['coordinator_id'],str(coordinator));self.assertEqual(p['dealer_ids'],[str(dealer)]);self.assertFalse(p['direct_deal'])
   if suffix=='transfer':
    self.actor(1)
    with self.assertRaises(psycopg.Error),self.c.transaction():self.c.execute('SELECT canto_api.v1_person_get(%s)',(customer,))
    self.c.execute('RESET ROLE')
  self.assertEqual(self.person(1,customer)['coordinator_id'],str(self.state['base']+1))
  result=self.clean();self.assertEqual(result['owned_commands'],10);self.assertEqual(result['owned_auth_revisions'],0)
if __name__=='__main__':unittest.main(verbosity=2)
