"""Staging real Auth/browser rehearsal. Exact-owned cleanup; no provider writes."""

import argparse, datetime, json, os, secrets, subprocess, sys, time, uuid, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/canto-sync"))
from database import connect, public_structure
from management import api
from test_hosted_business_journeys import source_state, cron_state, set_crons, serial

URL = "https://scvojtvgnkmbupvyslmb.supabase.co"
CHECKPOINT = ROOT / "tools/squad/private/dashboard-checkpoint.json"


def persist(s):
    CHECKPOINT.parent.mkdir(exist_ok=True, mode=0o700)
    with CHECKPOINT.open("w") as f:
        os.chmod(CHECKPOINT, 0o600)
        json.dump(s, f, default=serial)
        f.flush()
        os.fsync(f.fileno())


def cleanup(c, s):
    assert s["environment"] == "staging" and s["url"] == URL
    for actor in s["actors"]:
        assert actor["email"].startswith(s["label"].lower() + "-") and actor[
            "email"
        ].endswith("@example.invalid")
        if not actor.get("id"):
            row = c.execute(
                "SELECT id FROM auth.users WHERE email=%s", (actor["email"],)
            ).fetchone()
            if row:
                actor["id"] = str(row[0])
    actors = [uuid.UUID(a["id"]) for a in s["actors"] if a.get("id")]
    admin = actors[0] if actors else None
    with c.transaction():
        assert c.execute(
            "SELECT environment,cutover,active_job FROM sa_sync.environment_state"
        ).fetchone() == ("staging", False, None)
        assert set(
            c.execute("SELECT test_actor_ids FROM sa_domain.runtime_state").fetchone()[
                0
            ]
        ) <= set(actors), "Another rehearsal owns scope"
        c.execute(
            "UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL"
        )
        rows = c.execute(
            "SELECT actor_id,operation,kind,entity_id FROM sa_domain.audit WHERE id>%s ORDER BY id",
            (s["audit_start"],),
        ).fetchall()
        assert all(
            a == admin
            and op.startswith(
                ("dashboard.", "person.", "address.", "customer.", "account.")
            )
            for a, op, _, _ in rows
        ), "Foreign writes detected"
        current = c.execute(
            "SELECT edit_revision,synced_revision FROM sa_sync.environment_state"
        ).fetchone()
        delta = current[0] - s["edit_revision"]
        assert current[1] == s["synced_revision"] and delta == len(
            rows
        ), "Unowned revision delta"
        people = sorted(
            {int(entity) for _, _, kind, entity in rows if kind == "person"}
        )
        for pid in people:
            row = c.execute(
                "SELECT email FROM sa_snapshot_20261019.sa_users WHERE id=%s", (pid,)
            ).fetchone()
            assert (
                row
                and row[0].startswith(s["label"].lower() + "-")
                and row[0].endswith("@example.invalid")
            ), "Unowned customer"
        assert not c.execute(
            "SELECT 1 FROM sa_domain.outbox WHERE actor_id=ANY(%s::uuid[]) AND event_type<>'dashboard.export' AND (attempts<>0 OR status NOT IN('pending','done'))",
            (actors,),
        ).fetchone(), "Business worker ran"
        assert not c.execute(
            "SELECT 1 FROM sa_snapshot_20261019.sa_orders WHERE customer_id=ANY(%s::bigint[])",
            (people,),
        ).fetchone()
        assert not c.execute(
            "SELECT 1 FROM sa_identity.sa_auth_identities WHERE legacy_user_id=ANY(%s::bigint[])",
            (people,),
        ).fetchone()
        c.execute(
            "UPDATE sa_domain.outbox SET status='dead',last_error_code='DASHBOARD_REHEARSAL_CLEANUP',completed_at=now(),lease_token=NULL,lease_until=NULL WHERE actor_id=ANY(%s::uuid[]) AND status IN('pending','leased')",
            (actors,),
        )
        c.execute(
            "UPDATE sa_domain.account_requests SET state='failed',error_code='DASHBOARD_REHEARSAL_CLEANUP',updated_at=now() WHERE actor_id=ANY(%s::uuid[])",
            (actors,),
        )
        c.execute(
            "DELETE FROM sa_domain.dashboard_exports WHERE actor_id=ANY(%s::uuid[])",
            (actors,),
        )
        for table in ("sa_user_dealers", "sa_addresses"):
            c.execute(
                "DELETE FROM sa_snapshot_20261019."
                + table
                + " WHERE user_id=ANY(%s::bigint[])",
                (people,),
            )
        c.execute(
            "DELETE FROM sa_snapshot_20261019.sa_users WHERE id=ANY(%s::bigint[])",
            (people,),
        )
        if s.get("squad_source_id"):
            row = c.execute(
                "SELECT email FROM sa_snapshot_20261019.sa_users WHERE id=%s",
                (s["squad_source_id"],),
            ).fetchone()
            expected = s["label"].lower() + "-squad@example.invalid"
            assert row in [None, (expected,)]
            c.execute(
                "UPDATE sa_identity.sa_auth_identities SET enrollment_state='blocked' WHERE legacy_user_id=%s AND canonical_email=%s",
                (s["squad_source_id"], expected),
            )
            c.execute(
                "DELETE FROM sa_snapshot_20261019.sa_users WHERE id=%s",
                (s["squad_source_id"],),
            )
        assert (
            source_state(c) == s["source_before"]
        ), "Source mismatch; cleanup rolled back"
        c.execute(
            "UPDATE sa_sync.environment_state SET synced_revision=synced_revision+%s",
            (delta,),
        )
        c.execute(
            "DELETE FROM auth.refresh_tokens WHERE user_id=ANY(%s::text[])",
            ([str(x) for x in actors],),
        )
        c.execute("DELETE FROM auth.sessions WHERE user_id=ANY(%s::uuid[])", (actors,))
        for actor in s["actors"]:
            if not actor.get("id"):
                continue
            assert c.execute(
                "SELECT email FROM auth.users WHERE id=%s", (actor["id"],)
            ).fetchone() in [None, (actor["email"],)]
            c.execute("DELETE FROM auth.users WHERE id=%s", (actor["id"],))
            c.execute(
                "DELETE FROM public.admin_emails WHERE email=%s", (actor["email"],)
            )
        assert public_structure(c) == s["public_structure"]
    return {
        "source_content_restored": True,
        "owned_commands": delta,
        "edit_revision": current[0],
        "synced_revision": current[1] + delta,
        "audits_and_commands_retained": True,
        "fixture_auth_removed": len(actors),
        "native_provider_requests": 0,
    }


def run(recover=False, rpc_probe=False):
    if not recover:
        assert not CHECKPOINT.exists(), "Recover owned checkpoint first"
    with connect("staging") as c:
        assert c.execute("SELECT pg_try_advisory_lock_shared(20261107,1)").fetchone()[
            0
        ], "Refresh/release active"
        if recover:
            s = json.loads(CHECKPOINT.read_text())
            result = cleanup(c, s)
            set_crons(c, s, False)
            CHECKPOINT.unlink()
            print(json.dumps(result))
            return
        assert c.execute(
            "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261108154028'"
        ).fetchone(), "Deploy reviewed migration first"
        state = c.execute(
            "SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state"
        ).fetchone()
        assert state[:3] == ("staging", False, None) and state[3] == state[4]
        assert c.execute(
            "SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state"
        ).fetchone() == (False, [], None)
        assert not c.execute(
            "SELECT 1 FROM sa_domain.outbox WHERE status='leased' AND lease_until>now()"
        ).fetchone()
        s = {
            "environment": "staging",
            "url": URL,
            "label": "SQD" + uuid.uuid4().hex[:12],
            "actors": [],
            "crons": cron_state(c),
            "source_before": source_state(c),
            "public_structure": public_structure(c),
            "edit_revision": state[3],
            "synced_revision": state[4],
            "audit_start": c.execute(
                "SELECT coalesce(max(id),0) FROM sa_domain.audit"
            ).fetchone()[0],
        }
        persist(s)
        report = None
        try:
            set_crons(c, s, True)
            time.sleep(15)
            keymap = {v["name"]: v["api_key"] for v in api("staging", "/api-keys")}
            credentials = []
            for role in ("admin", "staff", "squad"):
                email = s["label"].lower() + "-" + role + "@example.invalid"
                password = secrets.token_urlsafe(30)
                s["actors"].append({"id": None, "email": email, "role": role})
                persist(s)
                req = urllib.request.Request(
                    URL + "/auth/v1/admin/users",
                    data=json.dumps(
                        {
                            "email": email,
                            "password": password,
                            "email_confirm": True,
                            "user_metadata": {"full_name": "Dashboard acceptance"},
                        }
                    ).encode(),
                    headers={
                        "Content-Type": "application/json",
                        "apikey": keymap["service_role"],
                        "Authorization": "Bearer " + keymap["service_role"],
                    },
                )
                with urllib.request.urlopen(req, timeout=45) as r:
                    user = json.load(r)
                s["actors"][-1]["id"] = user["id"]
                persist(s)
                credentials.append({"email": email, "password": password, "role": role})
                if role == "admin":
                    c.execute(
                        "INSERT INTO public.admin_emails(email) VALUES(%s)", (email,)
                    )
                    c.execute(
                        "UPDATE public.profiles SET role='admin' WHERE id=%s",
                        (user["id"],),
                    )
                elif role == "squad":
                    pid = c.execute(
                        "SELECT greatest(coalesce(max(legacy_user_id),1909000000),1909000000)+1 FROM sa_sync.legacy_identity_keys WHERE legacy_user_id BETWEEN 1909000000 AND 1909999999"
                    ).fetchone()[0]
                    assert pid < 1909999999
                    s["squad_source_id"] = pid
                    persist(s)
                    with c.transaction():
                        c.execute(
                            "INSERT INTO sa_snapshot_20261019.sa_users(id,email,encrypted_password,name,role,approved,confirmed_at,created_at,updated_at) SELECT %s,email,encrypted_password,'Dashboard denied Squad admin',0,true,now(),now(),now() FROM auth.users WHERE id=%s",
                            (pid, user["id"]),
                        )
                        c.execute(
                            "INSERT INTO sa_sync.legacy_identity_keys(legacy_user_id) VALUES(%s)",
                            (pid,),
                        )
                        c.execute(
                            "INSERT INTO sa_identity.sa_auth_identities(auth_user_id,legacy_user_id,canonical_email,import_disposition,enrollment_state,source_was_confirmed,confirmation_basis) VALUES(%s,%s,%s,'candidate','ready',true,'source_confirmed')",
                            (user["id"], pid, email),
                        )
                        c.execute(
                            "DELETE FROM public.profiles WHERE id=%s", (user["id"],)
                        )
                        c.execute(
                            "UPDATE auth.users SET role='sa_app',raw_app_meta_data=raw_app_meta_data||jsonb_build_object('application','canto','legacy_user_id',%s::bigint,'legacy_role_id',0) WHERE id=%s",
                            (pid, user["id"]),
                        )
            c.execute(
                "UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s::uuid[],test_write_expires_at=clock_timestamp()+interval '45 minutes'",
                ([s["actors"][0]["id"]],),
            )
            secret = c.execute(
                "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'"
            ).fetchone()[0]
            config = {
                "url": URL,
                "anon": keymap["anon"],
                "actors": credentials,
                "label": s["label"],
                "worker_secret": secret,
                "rpcProbe": rpc_probe,
            }
            # This file contains synthetic field diagnostics and timings, never credentials.
            with open("/tmp/dashboard-browser-progress.log", "w+") as progress:
                result = subprocess.run(
                    ["node", "tools/squad/test_dashboard_hosted_browser.mjs"],
                    input=json.dumps(config),
                    stdout=subprocess.PIPE,
                    stderr=progress,
                    text=True,
                    cwd=ROOT,
                    timeout=1800,
                )
                if result.returncode:
                    progress.seek(0)
                    raise RuntimeError(
                        "Dashboard acceptance failed: " + progress.read()[-6000:]
                    )
            report = json.loads(result.stdout)
        finally:
            proof = cleanup(c, s)
            set_crons(c, s, False)
            CHECKPOINT.unlink()
        report.update(
            cleanup=proof,
            environment="staging",
            timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        )
        (
            ROOT
            / ("docs/squad-one-audit/implementation-evidence/staging-dashboard-http-probe.json"
               if rpc_probe else "docs/squad-one-audit/implementation-evidence/staging-dashboard-browser.json")
        ).write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--recover", action="store_true")
    parser.add_argument("--rpc-probe", action="store_true")
    args = parser.parse_args()
    run(args.recover, args.rpc_probe)
