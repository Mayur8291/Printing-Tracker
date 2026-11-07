import os,sys,base64,tempfile,uuid,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import encrypted_backup as backup

class BackupTest(unittest.TestCase):
    def test_roundtrip_and_tamper_rejection(self):
        objects={}
        def storage(env,path,data=None):
            if data is not None:
                self.assertNotIn(path,objects);objects[path]=data
            return objects[path]
        original=backup.storage;backup.storage=storage
        os.environ['CANTO_BACKUP_KEY']=base64.b64encode(os.urandom(32)).decode()
        try:
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);(root/'before').mkdir()
                content=os.urandom(backup.CHUNK+100)
                (root/'before'/'table.copy.gz').write_bytes(content)
                (root/'before'/'admin-state.json').write_text('{"media":[],"state":{}}')
                job=str(uuid.uuid4());result=backup.upload('staging',job,root)
                self.assertTrue(result['read_back_verified']);self.assertGreater(result['chunks'],1)
                restored=backup.download('staging',job,root/'restore')
                self.assertEqual((restored/'table.copy.gz').read_bytes(),content)
                part=next(k for k in objects if k.endswith('00000.aesgcm'))
                objects[part]=objects[part][:-1]+bytes([objects[part][-1]^1])
                with self.assertRaises(Exception): backup.download('staging',job,root/'tampered')
                with self.assertRaises(Exception): backup.download('production',job,root/'wrong-env')
        finally:backup.storage=original

if __name__=='__main__':unittest.main()
