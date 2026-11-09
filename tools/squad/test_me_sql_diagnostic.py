"""Pure privacy/contract tests; no local or hosted database access."""
import json
import unittest
from me_sql_diagnostic import safe_plan

class MeSqlDiagnostic(unittest.TestCase):
    def test_explicit_plan_allowlist_excludes_identity_and_sql_values(self):
        raw={'Planning Time':1.5,'Execution Time':2.3,'Query Text':'secret token',
             'Plan':{'Node Type':'Index Scan','Index Name':'users_pkey','Actual Rows':1,
                     'Index Cond':"id='private-auth-uuid'",'Filter':'private@email.invalid',
                     'Output':['password-hash'],'Plans':[{'Node Type':'Result','Output':['secret']}],
                     'Unknown Metadata':'private-session'}}
        value=safe_plan(raw);serialized=json.dumps(value)
        self.assertEqual(value['Plan']['Index Name'],'users_pkey')
        self.assertEqual(value['Plan']['Plans'],[{'Node Type':'Result'}])
        for secret in ['secret','private','password','Query Text','Filter','Output','Index Cond']:
            self.assertNotIn(secret,serialized)
        self.assertEqual(value['Execution Time'],2.3)
    def test_nested_plan_fanout_bounded(self):
        self.assertEqual(len(safe_plan({'Plans':[{'Node Type':'Result'}]*100})['Plans']),32)
    def test_non_plan_values_do_not_escape(self):
        self.assertEqual(safe_plan('secret'),{})
        self.assertEqual(safe_plan({'Execution Time':{'secret':'token'}}),{})

if __name__=='__main__':unittest.main()
