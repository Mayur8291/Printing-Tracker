"""Read-only Git release inventory; never stages, commits, pushes or deploys.

The existing reviewed selection supplies provenance, not automatic permission.
Changed/new evidence and generated baselines remain explicit manual review items.
"""
import argparse
import base64
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / 'docs/squad-one-web/evidence/git-vercel-release-selection.json'
PUBLICATION_REVIEW = ROOT / 'docs/squad-one-web/evidence/publication-review-release-141.json'
TEXT = {'.py', '.mjs', '.js', '.jsx', '.ts', '.tsx', '.sql', '.json', '.md', '.csv', '.txt', '.toml', '.yml', '.yaml', '.css', '.html', '.lock'}
PATTERNS = {
    'private_key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
    'supabase_pat': re.compile(rb'\bsbp_[a-fA-F0-9]{40}\b'),
    'supabase_secret': re.compile(rb'\bsb_secret_[A-Za-z0-9_-]{20,}'),
    'github_token': re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})'),
    'aws_access_key': re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
}


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def statuses(raw):
    chunks = iter(raw.split(b'\0'))
    result = []
    for entry in chunks:
        if not entry:
            continue
        assert len(entry) > 3 and entry[2:3] == b' '
        status, path = entry[:2].decode(), entry[3:].decode('utf-8')
        row = {'path': path, 'git_status': status}
        if 'R' in status or 'C' in status:
            row['previous_path'] = next(chunks).decode('utf-8')
        result.append(row)
    return sorted(result, key=lambda row: row['path'])


def exclusion(path, explicit):
    parts = PurePosixPath(path).parts
    if path in explicit:
        return 'retained_publication_exclusion'
    if any(p in {'.git', 'node_modules', 'private', 'tmp', '.temp', 'dist', 'output', '__pycache__', '.venv'} for p in parts):
        return 'private_dependency_or_generated_directory'
    if PurePosixPath(path).suffix.lower() == '.log':
        return 'raw_log_publication_exclusion'
    if any(p == '.env' or p.startswith('.env.') or p.endswith(('.pem', '.p12', '.key')) for p in parts):
        return 'credential_or_environment_file'
    if path.startswith('/') or '..' in parts:
        return 'unsafe_path'
    return None


def secret_markers(raw):
    hits = []
    for name, pattern in PATTERNS.items():
        for match in pattern.finditer(raw):
            hits.append({'kind': name, 'line': raw[:match.start()].count(b'\n') + 1})
    # A public anon JWT is not a service credential. Other complete JWTs need
    # review; never retain their header/payload/token bytes in this report.
    for match in re.finditer(rb'\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+', raw):
        try:
            part = match.group(1)
            payload = json.loads(base64.urlsafe_b64decode(part + b'=' * (-len(part) % 4)))
            if isinstance(payload, dict) and payload.get('role') in {'service_role', 'supabase_admin'}:
                hits.append({'kind': 'privileged_jwt', 'line': raw[:match.start()].count(b'\n') + 1})
            elif isinstance(payload, dict) and payload.get('role') != 'anon':
                hits.append({'kind': 'nonpublic_jwt', 'line': raw[:match.start()].count(b'\n') + 1})
        except (ValueError, TypeError, UnicodeError):
            pass
    return sorted(hits, key=lambda x: (x['line'], x['kind']))


def inventory(root, dirty, baseline, excluded_outputs=(), publication=None):
    prior = {r['path']: (group, r) for group, rows in baseline['groups'].items() for r in rows}
    explicit = {r['path'] for r in baseline.get('public_git_exclusions', [])}
    explicit |= {r['path'] for r in baseline.get('private_tracker_screenshot_exclusions', [])}
    explicit |= set(excluded_outputs)
    approved = {r['path']: r['sha256'] for r in (publication or {}).get('approved_exact_files', [])}
    rows, excluded = [], []
    for item in dirty:
        path = item['path']; file = root / path
        reason = exclusion(path, explicit)
        if reason:
            excluded.append({'path': path, 'reason': reason}); continue
        row = dict(item); old = prior.get(path)
        row['prior_group'] = old[0] if old else None
        row['provenance'] = 'task_scope_classification_not_exclusive_authorship'
        if file.is_symlink() or not file.is_file():
            row.update(sha256=None, bytes=None, secret_markers=[], review='symlink_deletion_or_nonfile_manual_review')
        else:
            raw = file.read_bytes(); digest = hashlib.sha256(raw).hexdigest()
            text = file.suffix.lower() in TEXT and b'\0' not in raw
            row.update(sha256=digest, bytes=len(raw), secret_markers=secret_markers(raw) if text else [])
            same = bool(old and old[1].get('sha256') == digest)
            if row['secret_markers']:
                review = 'secret_marker_manual_review_do_not_publish'
            elif not text:
                review = 'reviewed_synthetic_image_unchanged' if same and old[0] == 'reviewed_synthetic_images' else 'binary_or_raw_log_manual_review'
            elif path.startswith('tools/canto-sync/baselines/') or (old and old[0] == 'requires_integrator_review'):
                review = 'generated_baseline_or_lock_manual_review'
            elif path.startswith('docs/'):
                review = 'prior_evidence_hash_unchanged' if same else 'new_or_changed_document_publication_review'
            elif old and old[0] in {'application_and_contracts', 'backend_source_and_regressions', 'owned_task_tools_and_tests'}:
                review = 'task_source_candidate_requires_integrator_approval'
            elif path.startswith('tools/squad/') or (path.startswith('supabase/migrations/') and '_squad_' in file.name):
                review = 'new_task_source_candidate_requires_integrator_approval'
            else:
                review = 'unclassified_existing_user_work_manual_review'
            if review in {'new_or_changed_document_publication_review', 'generated_baseline_or_lock_manual_review',
                          'binary_or_raw_log_manual_review'} and approved.get(path) == digest:
                row['publication_reviewed_category'] = review
                review = 'publication_reviewed_exact_hash'
            row['review'] = 'rename_or_copy_manual_review' if 'previous_path' in row else review
        rows.append(row)
    return rows, excluded


def collect(output):
    baseline = json.loads(BASELINE.read_text())
    publication = json.loads(PUBLICATION_REVIEW.read_text()) if PUBLICATION_REVIEW.exists() else None
    rel_output = str(output.relative_to(ROOT)) if ROOT in output.parents else None
    rows, excluded = inventory(ROOT, statuses(git('status', '--porcelain=v1', '-z', '--untracked-files=all')), baseline, [rel_output] if rel_output else [], publication)
    return {'format': 'squad-selective-git-candidates/v1', 'status': 'read_only_candidates_not_staging_authorization',
            'branch': git('branch', '--show-current').decode().strip(), 'head': git('rev-parse', 'HEAD').decode().strip(),
            'baseline_path': str(BASELINE.relative_to(ROOT)), 'baseline_sha256': hashlib.sha256(BASELINE.read_bytes()).hexdigest(),
            'publication_review_sha256': hashlib.sha256(PUBLICATION_REVIEW.read_bytes()).hexdigest() if publication else None,
            'self_output_exclusion': rel_output, 'index_empty': not bool(git('diff', '--cached', '--name-only', '-z')),
            'candidate_files': rows, 'excluded_paths': excluded, 'review_counts': dict(sorted(Counter(r['review'] for r in rows).items())),
            'exclusion_counts': dict(sorted(Counter(r['reason'] for r in excluded).items())),
            'secret_marker_paths': [r['path'] for r in rows if r['secret_markers']],
            'limitations': ['Source candidates are not proof of exclusive authorship or publication approval.',
                           'Secret-marker scan is bounded high-confidence detection, not complete secret/PII certification.',
                           'New/changed documents require content review; exact old screenshot/log exclusions persist.',
                           'No index/ref/remote mutation. Select approved exact paths only; never git add . or automatic promotion.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--output', type=Path); group.add_argument('--verify', type=Path)
    args = parser.parse_args(); path = (args.output or args.verify).resolve()
    current = collect(path)
    if args.verify:
        old = json.loads(path.read_text())
        # Volatile excluded dependencies/private outputs are not release input.
        for key in ('branch', 'head', 'baseline_sha256', 'publication_review_sha256', 'index_empty', 'candidate_files'):
            if old[key] != current[key]:
                raise SystemExit('Release snapshot changed: ' + key)
    else:
        path.write_text(json.dumps(current, indent=2) + '\n')
    print(json.dumps({'mode': 'verified' if args.verify else 'candidate_snapshot', 'files': len(current['candidate_files']),
                      'review_counts': current['review_counts'], 'excluded': len(current['excluded_paths']),
                      'secret_marker_path_count': len(current['secret_marker_paths']), 'index_empty': current['index_empty']}))


if __name__ == '__main__':
    main()
