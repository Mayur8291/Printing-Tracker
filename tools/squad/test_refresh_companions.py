"""Local-only production848 refresh + full destination850 rollback regression."""
import copy,gzip,json,tempfile,unittest,uuid
from pathlib import Path
from unittest.mock import patch
from local_db import connect
from fixtures import seed_orders
from delta_sync import backup_columns,copy_lines,plan_delta,apply_changes,project_copy_line
from snapshot import fingerprint
from database import content
import encrypted_backup


class RefreshCompanions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c:seed_orders(c)

    def setUp(self):
        self.c=connect();self.c.execute('BEGIN')
        # The synthetic domain harness omits this older refresh-only singleton.
        self.c.execute("CREATE TABLE IF NOT EXISTS sa_media.state(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),summary jsonb NOT NULL DEFAULT '{}',updated_at timestamptz NOT NULL DEFAULT now())")
        self.c.execute("INSERT INTO sa_media.state(singleton) VALUES(true) ON CONFLICT DO NOTHING")
        self.temp=tempfile.TemporaryDirectory();self.directory=Path(self.temp.name)
        source=json.loads((Path(__file__).parents[1]/'canto-sync/baselines/production.json').read_text())['tables']['orders']
        seq=self.c.execute('SELECT last_value,is_called FROM sa_snapshot_20261019.sa_orders_id_seq').fetchone()
        self.manifest={'environment':'production','tables':{'orders':{'target':'sa_orders','columns':source}},
          'sequences':{'orders_id_seq':{'target':'sa_orders_id_seq','value':seq[0],'called':seq[1]}}}
        for n in [880000001,880000002]:
            self.c.execute("INSERT INTO sa_snapshot_20261019.sa_orders(id,customer_id,address_id,order_source,dashboard_reservation_id,created_at,updated_at) VALUES(%s,103,100,'dashboard',%s,now(),now())",(n,'reserved\tline\n'+str(n)))

    def tearDown(self):
        self.c.execute('ROLLBACK');self.c.close();self.temp.cleanup()

    def source(self,manifest=None,delete=None,update=None):
        manifest=manifest or self.manifest
        target=self.directory/('source-'+uuid.uuid4().hex);target.mkdir()
        columns=manifest['tables']['orders']['columns'];lines=[]
        for line in copy_lines(self.c,'sa_orders',columns):
            parts=line[:-1].split(b'\t');key=int(parts[columns.index('id')])
            if key==delete:continue
            if key==update:parts[columns.index('paid_amount')]=b'123.45'
            lines.append(b'\t'.join(parts)+b'\n')
        (target/'orders.copy').write_bytes(b''.join(lines))
        manifest=copy.deepcopy(manifest);manifest['tables']['orders'].update(fingerprint(lines))
        return target,manifest

    def plan(self,source,manifest):
        work=self.directory/('run-'+uuid.uuid4().hex);work.mkdir()
        changes,totals,before=plan_delta(self.c,manifest,{'orders':['id']},work,source)
        return work,changes,totals,before

    def test_refresh_updates_source_columns_and_preserves_companions(self):
        source,manifest=self.source(update=880000001)
        work,changes,totals,before=self.plan(source,manifest)
        self.assertEqual(totals['updated'],1)
        self.assertEqual(before['tables']['orders']['columns'][-2:],['dashboard_reservation_id','order_source'])
        apply_changes(self.c,manifest,{'orders':['id']},changes,work)
        row=self.c.execute('SELECT paid_amount,order_source,dashboard_reservation_id FROM sa_snapshot_20261019.sa_orders WHERE id=880000001').fetchone()
        self.assertEqual(str(row[0]),'123.45');self.assertEqual(row[1:],('dashboard','reserved\tline\n880000001'))
        self.assertEqual(content(self.c,'sa_snapshot_20261019','sa_orders',manifest['tables']['orders']['columns']),{'rows':manifest['tables']['orders']['rows'],'sha256':manifest['tables']['orders']['sha256']})

    def test_deleted_order_rollback_restores_both_companions_and_encrypted_backup(self):
        source,manifest=self.source(delete=880000002)
        work,changes,totals,before=self.plan(source,manifest)
        full=before['tables']['orders'];self.assertEqual(totals['deleted'],1)
        self.assertEqual(content(self.c,'sa_snapshot_20261019','sa_orders',full['columns']),{'rows':full['rows'],'sha256':full['sha256']})
        # Actual encrypted archive/read-back/decrypt path, with only the remote
        # Storage transport and key replaced by an in-memory test destination.
        stored={}
        def storage(env,path,data=None):
            self.assertEqual(env,'production')
            if data is not None:stored[path]=data;return b''
            return stored[path]
        job=str(uuid.uuid4())
        with patch.object(encrypted_backup,'storage',storage),patch.object(encrypted_backup,'key',return_value=b'x'*32):
            result=encrypted_backup.upload('production',job,work)
            self.assertTrue(result['read_back_verified'])
            restored=encrypted_backup.download('production',job,self.directory/'decrypted')
        saved=json.loads((restored/'manifest.json').read_text())
        self.assertEqual(saved['tables']['orders']['columns'],full['columns'])
        recovered=self.directory/'rollback-source';recovered.mkdir()
        with gzip.open(restored/'orders.copy.gz','rb') as inp:raw=inp.read()
        (recovered/'orders.copy').write_bytes(raw)
        self.assertEqual(fingerprint(raw.splitlines(keepends=True)),{'rows':full['rows'],'sha256':full['sha256']})
        apply_changes(self.c,manifest,{'orders':['id']},changes,work)
        self.assertIsNone(self.c.execute('SELECT id FROM sa_snapshot_20261019.sa_orders WHERE id=880000002').fetchone())
        # Real refresh and rollback commit separately; emulate only their
        # ON COMMIT DROP temp-table cleanup within this rollback-only test.
        self.c.execute('DROP TABLE pg_temp.canto_delta_0,pg_temp.canto_deleted_0')
        reverse,restore_changes,restore_totals,_=self.plan(recovered,saved)
        self.assertEqual(restore_totals['inserted'],1)
        apply_changes(self.c,saved,{'orders':['id']},restore_changes,reverse)
        self.assertEqual(self.c.execute('SELECT order_source,dashboard_reservation_id FROM sa_snapshot_20261019.sa_orders WHERE id=880000002').fetchone(),('dashboard','reserved\tline\n880000002'))
        self.assertEqual(content(self.c,'sa_snapshot_20261019','sa_orders',full['columns']),{'rows':full['rows'],'sha256':full['sha256']})

    def test_new_source_order_gets_reviewed_destination_defaults(self):
        source,manifest=self.source();columns=manifest['tables']['orders']['columns']
        lines=(source/'orders.copy').read_bytes().splitlines(keepends=True)
        original=next(line for line in lines if int(line.split(b'\t')[columns.index('id')])==880000001)
        fields=original[:-1].split(b'\t');fields[columns.index('id')]=b'880000003'
        lines.append(b'\t'.join(fields)+b'\n');(source/'orders.copy').write_bytes(b''.join(lines))
        manifest['tables']['orders'].update(fingerprint(lines))
        work,changes,totals,_=self.plan(source,manifest)
        self.assertEqual(totals['inserted'],1)
        apply_changes(self.c,manifest,{'orders':['id']},changes,work)
        self.assertEqual(self.c.execute('SELECT order_source,dashboard_reservation_id FROM sa_snapshot_20261019.sa_orders WHERE id=880000003').fetchone(),('unicommerce',None))

    def test_companion_only_change_is_not_source_delta_but_is_in_backup_digest(self):
        source,manifest=self.source()
        _,changes,totals,before=self.plan(source,manifest)
        self.assertEqual(changes,{})
        self.c.execute("UPDATE sa_snapshot_20261019.sa_orders SET dashboard_reservation_id='changed' WHERE id=880000001")
        _,changes,totals,after=self.plan(source,manifest)
        self.assertEqual(changes,{})
        self.assertNotEqual(before['tables']['orders']['sha256'],after['tables']['orders']['sha256'])
        self.assertEqual(manifest['tables']['orders']['columns'],self.manifest['tables']['orders']['columns'])

    def test_unknown_extra_column_is_not_silently_ignored(self):
        self.c.execute('ALTER TABLE sa_snapshot_20261019.sa_orders ADD COLUMN unreviewed_extra text')
        with self.assertRaisesRegex(RuntimeError,'Unreviewed destination-only'):
            backup_columns(self.c,'production','orders',self.manifest['tables']['orders'])

    def test_incompatible_companion_default_is_rejected(self):
        self.c.execute("ALTER TABLE sa_snapshot_20261019.sa_orders ALTER COLUMN order_source SET DEFAULT 'dashboard'")
        with self.assertRaisesRegex(RuntimeError,'Unreviewed destination-only'):
            backup_columns(self.c,'production','orders',self.manifest['tables']['orders'])

    def test_staging_full_manifest_path_is_unchanged(self):
        full=copy.deepcopy(self.manifest);full['environment']='staging'
        full['tables']['orders']['columns']+=['dashboard_reservation_id','order_source']
        source,manifest=self.source(full)
        _,changes,totals,before=self.plan(source,manifest)
        self.assertEqual(changes,{})
        self.assertEqual(before['tables']['orders'],manifest['tables']['orders'])

    def test_copy_projection_preserves_escapes_and_nulls(self):
        line=b'1\tleft\\tright\\nnext\t\\N\tprovider\n'
        self.assertEqual(project_copy_line(line,[0,2,1],4),b'1\t\\N\tleft\\tright\\nnext\n')
        with self.assertRaisesRegex(RuntimeError,'column count'):
            project_copy_line(line,[0],5)

if __name__=='__main__':unittest.main(verbosity=2)
