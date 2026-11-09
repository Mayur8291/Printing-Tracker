import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from release_git_selector import exclusion, inventory, secret_markers, statuses


class ReleaseSelector(unittest.TestCase):
    def test_porcelain_rename_and_spaces_are_exact(self):
        result = statuses(b' M a b.py\0R  new.py\0old.py\0?? z.py\0')
        self.assertEqual(result[1], {'path': 'new.py', 'git_status': 'R ', 'previous_path': 'old.py'})
        self.assertEqual(result[0]['path'], 'a b.py')

    def test_sensitive_and_generated_paths_never_candidates(self):
        for path in ['node_modules/a', 'apps/admin/node_modules/a', 'tools/squad/private/file.json',
                     'apps/admin/dist/index.html', '.env.staging', 'tools/.temp/a', '../x', 'output/pdf/report.pdf', 'docs/actual.log']:
            self.assertIsNotNone(exclusion(path, set()), path)
        self.assertEqual(exclusion('docs/screen.png', {'docs/screen.png'}), 'retained_publication_exclusion')

    def test_secret_output_never_contains_value_and_public_jwt_not_privileged(self):
        def jwt(role):
            body = base64.urlsafe_b64encode(json.dumps({'role': role}).encode()).rstrip(b'=')
            return b'eyJhbGciOiJIUzI1NiJ9.' + body + b'.abc123'
        token = b'sbp_' + b'a' * 40
        hits = secret_markers(token + b'\n' + jwt('service_role') + b'\n' + jwt('anon') + b'\n' + jwt('authenticated'))
        self.assertEqual([h['kind'] for h in hits], ['supabase_pat', 'privileged_jwt', 'nonpublic_jwt'])
        self.assertNotIn(token.decode(), json.dumps(hits))

    def test_changed_evidence_unknown_source_and_symlinks_need_review(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name, content in [('docs/evidence.json', '{}'), ('user.py', 'print(1)'), ('tools/squad/test.py', 'print(2)')]:
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(content)
            (root / 'link.py').symlink_to(root / 'user.py')
            baseline = {'groups': {}, 'public_git_exclusions': [{'path': 'docs/private.png'}]}
            dirty = [{'path': p, 'git_status': '??'} for p in ['docs/evidence.json', 'user.py', 'tools/squad/test.py', 'link.py', 'docs/private.png']]
            rows, excluded = inventory(root, dirty, baseline)
            by_path = {r['path']: r for r in rows}
            self.assertEqual(by_path['docs/evidence.json']['review'], 'new_or_changed_document_publication_review')
            self.assertEqual(by_path['user.py']['review'], 'unclassified_existing_user_work_manual_review')
            self.assertEqual(by_path['link.py']['review'], 'symlink_deletion_or_nonfile_manual_review')
            self.assertIsNone(by_path['link.py']['sha256'])
            self.assertEqual(len(excluded), 1)

    def test_same_inventory_is_deterministic_but_content_drift_changes_receipt(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); p = root / 'user.py'; p.write_text('print(1)')
            dirty = [{'path': 'user.py', 'git_status': ' M'}]; baseline = {'groups': {}}
            first = inventory(root, dirty, baseline)
            self.assertEqual(first, inventory(root, dirty, baseline))
            p.write_text('print(2)')
            self.assertNotEqual(first, inventory(root, dirty, baseline))

    def test_image_approval_is_bound_to_exact_reviewed_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); p = root / 'synthetic.png'; p.write_bytes(b'synthetic reviewed bytes')
            baseline = {'groups': {'reviewed_synthetic_images': [{'path': 'synthetic.png', 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}]}}
            dirty = [{'path': 'synthetic.png', 'git_status': '??'}]
            self.assertEqual(inventory(root, dirty, baseline)[0][0]['review'], 'reviewed_synthetic_image_unchanged')
            p.write_bytes(b'other image')
            self.assertEqual(inventory(root, dirty, baseline)[0][0]['review'], 'binary_or_raw_log_manual_review')

    def test_publication_receipt_is_hash_bound_and_cannot_clear_secret_or_exclusion(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); p = root / 'docs/evidence.json'; p.parent.mkdir(); p.write_text('{}')
            dirty = [{'path': 'docs/evidence.json', 'git_status': '??'}]; baseline = {'groups': {}}
            receipt = {'approved_exact_files': [{'path': 'docs/evidence.json', 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}]}
            self.assertEqual(inventory(root, dirty, baseline, publication=receipt)[0][0]['review'], 'publication_reviewed_exact_hash')
            p.write_text('{"changed":true}')
            self.assertEqual(inventory(root, dirty, baseline, publication=receipt)[0][0]['review'], 'new_or_changed_document_publication_review')
            p.write_text('sbp_' + 'a' * 40); receipt['approved_exact_files'][0]['sha256'] = hashlib.sha256(p.read_bytes()).hexdigest()
            self.assertEqual(inventory(root, dirty, baseline, publication=receipt)[0][0]['review'], 'secret_marker_manual_review_do_not_publish')
            baseline['public_git_exclusions'] = [{'path': 'docs/evidence.json'}]
            self.assertEqual(inventory(root, dirty, baseline, publication=receipt)[0], [])


if __name__ == '__main__':
    unittest.main()
