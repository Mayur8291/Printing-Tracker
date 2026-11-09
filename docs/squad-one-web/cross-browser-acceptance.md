# Cross-browser acceptance setup

The isolated test runner uses Playwright **1.65.0**, Firefox **159.0** (engine build 1572) and WebKit **27.2** (engine build 2388). The package is installed at `/tmp/squad-playwright-1.65.0`; browser binaries are at `/tmp/squad-playwright-browsers-1.65.0`. No application dependency or lockfile changes were made. Official setup references: [Playwright library](https://playwright.dev/docs/library), [browser installation](https://playwright.dev/docs/browsers).

WebKit engine testing is **not native Safari certification**. Native Safari 26.1 is installed, but its WebDriver session has not been enabled or run. No Mac automation settings were changed.

## Completed local checks

- Both engines launch headlessly at 360×844.
- `node tools/squad/web-cross-browser-local.mjs`: actual shared React form and dialog, production CSS, 9 checks per engine: label association, controlled input edit, keyboard opening, viewport bounds, tab containment, Escape, invoker focus restoration, no horizontal overflow and no JavaScript exception.
- Both rendered 360px dialogs were independently visually reviewed. Labels, inputs, focus outline and stacked actions fit with no clipping.
- `node --test tools/squad/web-cross-browser-policy.test.mjs`: four tests cover explicit read allowlisting, the stock RPC's read actions, provider/media/account write denial, environment separation and fixture Auth lifecycle.
- `SQUAD_UI_REVIEW_WIDTH=360 node tools/squad/web-current-ui-review.mjs`: ten populated Chrome checks including People, keyboard-only edit modal, scoped order contact, dealer shortage quote and worker history at 360/1440px.

The stricter keyboard check found that controlled command dialogs without a Radix `DialogTrigger` lost focus to the document after Escape. `SquadDialogContent` now remembers the actual external invoker and restores focus only if it remains connected, respecting explicit caller autofocus handling. The shared and commerce command dialogs use this wrapper. The independent commerce review found no blocker; this proof covers these command dialogs, not every possible nested/custom dialog.

## Parent-owned hosted execution

`tools/squad/web-cross-browser-hosted.mjs` consumes the same stdin JSON protocol as `web-business-hosted.mjs`: exact staging URL, run UUID, all 11 fixture actors with credentials/Auth IDs, and `fixture.actors` business IDs. It neither creates fixtures nor changes their permissions. The parent must hold the existing exclusive fixture/refresh lock, keep its cleanup checkpoint, and perform exact cleanup after all browser contexts close.

The adapter runs real login and every permitted navigation entry in each engine. It compares the actual `v1_me` role/Auth/business IDs to the parent fixture, checks route errors/labels/overflow, tests 360px keyboard menu navigation and profile input editing without submitting, and opens the Admin city form without saving. Enabled actions are determined by the actual server write state; disabled forms are recorded as such. A positive request allowlist blocks application mutations, raw table transport, production access and external destinations. Private screenshots and reports go only under ignored `tools/squad/private/web-cross-browser-<run UUID>/`.

Invocation by the parent, with credentials streamed privately over stdin:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/squad-playwright-browsers-1.65.0 node tools/squad/web-cross-browser-hosted.mjs
```

The dedicated parent is `tools/squad/test_web_cross_browser_hosted.py`. It defaults to read-only preflight and accepts exactly one engine per fixture (`--engine firefox` or `--engine webkit`) with a720-second browser timeout inside the existing15-minute test scope. The integrator uses `--execute`; `--recover` accepts only the exact cross-browser marker and needs no installed browser runtime. It reuses existing fixture planning, creation, exact server cleanup and cron helpers without modifying the main business harness. Its command journal must stay empty; browser observations cannot authorize cleanup of unexpected writes.

```sh
../Canto/canto-sync/.venv/bin/python tools/squad/test_web_cross_browser_hosted.py --engine firefox
../Canto/canto-sync/.venv/bin/python tools/squad/test_web_cross_browser_hosted.py --engine webkit
../Canto/canto-sync/.venv/bin/python -m unittest discover -s tools/squad -p test_web_cross_browser_harness.py -v
```

Nineteen lifecycle tests pass without any database connection. They use the real deterministic fixture manifest and validators with temporary checkpoints/fake connection boundaries to verify read-only default, exact payload shape, shared/exclusive lock ordering, engine selection, credential clearing, child failure, timeout diagnostic redaction, cleanup refusal, cron restore refusal, recovery marker rejection, checkpoint races, blocked command journals and failed evidence rejection. These test the new orchestration boundaries; existing server cleanup proof remains in the reused SQL-tested helper.

No hosted run has been performed by the UI lane. Local engine/form checks do not establish real multi-persona backend acceptance, native Safari behavior or full WCAG conformance. Those evidence categories remain separate.

## Native Safari attempt

On9 November, the coordinator requested a CUA-only anonymous route smoke in a new Safari tab: sign-in, registration, confirmation and recovery, without credentials, form submissions or hosted fixtures. CUA's inventory reported that the Mac was locked and automatic unlock failed. No tab was created, existing DigitalOcean tabs were untouched, and no application/browser settings were changed. Native Safari26.1 remains unverified for these routes; the installed Playwright WebKit27.2 result must not be substituted for it.

## Bounded native Safari acceptance queued after mailbox work

The coordinator owns CUA while inspecting the authorized test mailboxes. After that explicit handoff, use a new native Safari tab and preserve all existing tabs. The authenticated scope requires the coordinator's still-valid disposable staging Customer and its exact identity/cleanup owner; a synthetic component fixture cannot replace it. Supply credentials through the coordinator's existing private in-memory protocol and masked login fields, without screenshots of credentials, values in evidence or password output. Do not create another account or reuse a cleared fixture.

1. Open the exact reviewed frontend URL with staging selected, verify the existing sign-in UI, and log in as the parent-owned Customer. Confirm the resulting Customer workspace and expected fixture display name. The coordinator verifies the Auth/business identity binding independently; visual name matching alone is not the identity proof.
2. On Home, use the actual `Created from` and `Through` native date controls. Apply a valid bounded period, observe settled scoped data or intentional empty results, then use `All time`. Exercise incomplete/reversed-date validation without changing data. Customer does not have a Reports navigation item; do not invent or grant one for this test.
3. Use keyboard navigation to open the actual product-share dialog, tab through its available controls, close with Escape, and verify focus returns. Use one existing authorized ready product selected by the parent's accepted content-media discovery, request fresh grants through `Prepare images`, then click `Download ZIP`. Verify Safari's completed download through native browser UI; compare the exact downloaded file bytes against the parent's source/hash oracle through the permitted file tool. If the source is missing, record the explicit missing state and fail the download check rather than substituting a mocked file. An already-produced owned PDF can be substituted only with exact document/grant ownership and expected bytes supplied by the parent.
4. Reload the Customer page to verify session restoration, then sign out locally and verify protected navigation returns to sign-in. Capture non-sensitive settled desktop and narrow-window states. Record actual Safari version, exact application revision/URL, date-control result, focus result, completed download/hash result and any error separately.

These are native Safari core controls, not all eleven native-Safari persona journeys, OS file-sharing completion, provider effects, screen-reader certification or full WCAG compliance. No account/domain writes, uploads, document generation or provider calls are part of this sequence. Parent fixture expiry and cleanup remain authoritative; if its validity ends, stop rather than reviving it. No native test has been executed from these prepared steps.

### Optional native Safari handoff (implemented; hosted execution pending)

The dedicated parent now accepts `--native-safari` with `--execute`. After its engine checks pass, it retains the already-created Customer credential only in memory and opens a random loopback port with one nonce-scoped page. The page displays copy buttons, never visible credentials. Direct user gestures write the email/password to the clipboard; no clipboard read, credential output, secret file, cookie extraction or password change is used. Responses prohibit caching and external resources, verify the exact loopback Host, reject cross-origin requests and disable request logging.

Native Safari has no automated request interceptor. The visible handoff explicitly restricts the operator to navigation, reading, keyboard/date-filter checks and a preselected authorized download after sign-in. Business-form saves/submissions, uploads, orders and data changes are prohibited; an unexpected unjournaled mutation must not be silently cleaned up.

The coordinator must finish mailbox work and own CUA before this mode starts. Preselect the existing authorized product/download oracle and exact staging frontend before the window. The server queries the actual fixture expiry and permits at most300 seconds, ending at least60 seconds before that lease. If fewer than30 seconds remain, no credential page is exposed and normal exact cleanup runs. The fixture lifetime is never extended.

After the native checks, sign out in the application and close its test tab. In the handoff tab, check both confirmations and press **Finished — clear clipboard and release fixture**. This direct gesture clears the clipboard and sends the explicit shutdown acknowledgement. Then close the handoff tab. The parent does not infer a manual pass from this acknowledgement; the engine result retains `native_safari_tested:false` and the coordinator records native evidence separately.

Timeout, interruption or uncertain shutdown preserves the checkpoint and paused cron state. An ordinary `--recover` refuses cleanup while the handoff is active/unconfirmed. Only after the coordinator independently verifies logout, application-tab closure and clipboard clearing may they use `--recover --confirm-native-shutdown`. The recovery flag is an explicit owner attestation, not an automated proof. A process crash before persisting the successful acknowledgement is conservatively unconfirmed.

Local tests:19 parent lifecycle tests plus7 loopback/lease tests pass without hosted connections. They cover exact Customer binding, actual lease bounds, no-store/CSP/nonces/Host/Origin restrictions, no request output, explicit acknowledgement, timeout, cleanup refusal, recovery attestation and absence of a native-acceptance claim. A separate local Chrome page check passes7 rendered checks: invisible credentials, direct copy controls, both shutdown confirmations, clipboard clearing before acknowledgement, disabled copy controls after completion,360px bounds and actual CSP script execution. It uses only synthetic values with a mocked clipboard and does not touch the system clipboard. The360px screenshot was visually inspected. Existing default engine execution is unchanged. No native Safari hosted run has been performed by this lane.

### Clean-artifact origin and entry binding

The parent now accepts `--base`, defaulting to `http://localhost:5183`. Only an explicit loopback HTTP origin is accepted; credentials, external hosts, paths, queries and fragments are rejected. Before connecting to the database or creating a fixture, a bounded, redirect-free preflight reads the exact HTML module entry and hashes its served bytes. Both built `/assets/index-*.js` and the existing Vite `/src/main.jsx` entry (including its exact numeric `t` revision) are supported. The frontend origin, entry path and SHA-256 enter the parent checkpoint and private stdin payload. Every persona context verifies the actual entry response, and the parent checks the same served entry again before accepting the report. This is an entry-bundle binding, not a hash proof of every lazy chunk.

For the accepted clean build, the coordinator can run these separately, after the current fixture has been cleaned:

```sh
../Canto/canto-sync/.venv/bin/python tools/squad/test_web_cross_browser_hosted.py --engine firefox --base http://127.0.0.1:5186
../Canto/canto-sync/.venv/bin/python tools/squad/test_web_cross_browser_hosted.py --execute --engine firefox --base http://127.0.0.1:5186
../Canto/canto-sync/.venv/bin/python tools/squad/test_web_cross_browser_hosted.py --execute --engine webkit --base http://127.0.0.1:5186
```

The first command is read-only preflight. The following commands create the existing disposable fixture and therefore belong to the coordinator's serialized hosted queue. Add `--native-safari` only when the coordinator is ready to operate native Safari and finish the bounded handoff before the lease expires. Recovery uses its stored frontend binding and does not require that server to remain available. Existing lock, cleanup, timeout and native-shutdown rules are unchanged.

The initial clean entry observed by a local-only preflight was `/assets/index-BTsRt4gB.js`, SHA-256 `51e8448aeb60144dfaa3875a2252e1af60084cb2a994010d6c8469a2078a7f29`. Twenty-four lifecycle tests, six local HTTP manifest tests and two child binding tests pass. No hosted engine execution was performed by the UI lane for this change.

The reviewed operations-refresh fix was subsequently rebuilt once in the same isolated dependency tree. The current clean preview entry is `/assets/index-D0HIEzmj.js`, SHA-256 `d89fa29a6b7150d06d49eeead69dd11a826712b45d7d5ed649564619a6e47085`. Use the current `evidence/clean-web-build-execution.json` as the artifact handoff; `clean-web-initial-*` retains the previous build evidence. The parent preflight will bind the currently served entry before creating a fixture.
