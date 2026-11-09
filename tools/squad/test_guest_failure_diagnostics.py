import copy
import unittest
from guest_failure_diagnostics import validate_diagnostic

class GuestFailureDiagnostics(unittest.TestCase):
    def test_accepts_only_bounded_safe_diagnostic(self):
        value={'format':'squad-guest-failure/v1','kind':'recovery','stage':'completion_status','type':'TimeoutError','code':None,
               'frames':[{'file':'web-account-entry-adapter.mjs','line':82,'column':16}]}
        self.assertEqual(validate_diagnostic(value),value)
        for mutate in (
            lambda v:v.update(message='password or code'),lambda v:v.update(stage='arbitrary secret'),
            lambda v:v.update(code='Bearer private'),lambda v:v.update(frames=v['frames']*9),
            lambda v:v['frames'][0].update(file='/private/web-account-entry-adapter.mjs'),
            lambda v:v['frames'][0].update(line=True),
        ):
            invalid=copy.deepcopy(value);mutate(invalid)
            with self.assertRaises(AssertionError):validate_diagnostic(invalid)

if __name__=='__main__':unittest.main()
