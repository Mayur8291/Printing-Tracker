# Queue and provider retry review

Review scope: current local integrated code through `20261108093125`, synthetic PostgreSQL `squad_test_stock`, and mocked provider HTTP. No provider requests, hosted mutations, or cutover activation were performed.

## Corrected: warehouse cooldown could be lost

Before the correction, `warehouseHttp` parsed every response as JSON before interpreting its HTTP status. A gateway response with status 429, `Retry-After: 900`, and plain-text `Too Many Requests` produced `RETRY / PROVIDER_RESPONSE_INVALID` without a delay. The first SQL retry therefore used the normal approximately 10-second queue backoff. The identical response with JSON `{}` preserved the 900-second delay. A future HTTP-date header also fell back to 60 seconds.

`warehouse-http.ts` now interprets retryable statuses (408, 429, and 5xx) before reading an error body. It cancels the response stream without waiting for cancellation, returns only the existing allowlisted error, and preserves the retry delay. Successful responses still require bounded, valid JSON. Neither raw response bodies nor headers are persisted.

The parser accepts delay-seconds and the HTTP-date forms defined by [RFC 9110, Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after). Date values are converted to a ceiling in seconds using the worker clock. The existing operational policy remains a 5–3600-second header delay, with 60 seconds for missing or malformed headers. The SQL wrapper still imposes at least its exponential queue backoff. Values beyond one hour are deliberately capped; this is an operational policy, not a claim that the full upstream wait was honored. It should be revisited if a verified provider requires longer cooldowns.

Mutation uncertainty is unchanged: receiving a retryable HTTP status does not prove that a mutation did not happen. Existing durable request lookup, prior-attempt evidence, and Uniware reconciliation gates still apply. No automatic second mutation was added.

The adjacent 401/403 case now preserves the status with an empty object when the body is absent or malformed. It does not throw before adapter handling: Uniware can still refresh credentials and repeat a read once, fall back from a rejected refresh token to its configured password grant, and stop after one uncertain mutation. Dashboard still applies its existing 300-second authorization cooldown. Body-size and deadline bounds remain enforced.

Validation: **46/46 warehouse tests** and **199/199 squad-jobs tests** passed, along with the worker typecheck. Seven new tests cover 16 combinations of retryable status and empty/text/HTML/malformed bodies, numeric/date bounds and obsolete HTTP-date forms, malformed/missing headers, a stalled error stream, invalid successful responses, and authorization-body/refresh handling. The uncertain-mutation test was also extended to JSON, plain-text and absent401 bodies and verifies that negative mutation-attempt proof is never fabricated. Existing single-flight OAuth, provider body-size, total-deadline and replay tests remain green. All provider responses were mocked.

## Corrected locally: order retries blocked unrelated inventory polling

The current scheduler admits one active reconciliation per provider, regardless of scope. A completed inventory round followed by one active orders round can therefore prevent the next inventory refresh, even when the worker has capacity and inventory endpoints could respond successfully.

The rollback-only reproduction used the actual schedule, claim, prepare and finish RPCs:

1. Configure the schedule and complete an inventory round.
2. Start an orders round with one ready-made order.
3. Finish that order poll with `RETRY` and `retry_after_seconds: 3600`.
4. Move the inventory deadline into the past and the cache timestamp six minutes into the past, without waiting or changing source business data.
5. Call the heartbeat and the customer catalogue RPC.

Observed: the order job remains pending with 3600 seconds of cooldown; heartbeat returns `busy` for the same orders reconciliation; zero inventory jobs are pending; catalogue availability is `stale`. The source is the cross-scope active-run check in `squad_warehouse_heartbeat`, together with the existing provider-wide reconciliation exclusion.

Follow-up migration `20261108094744_squad_warehouse_scope_isolation.sql` permits one orders run and one inventory run concurrently. Two partial unique indexes each include `all`: active orders/all, and active inventory/all. This enforces all three overlap relationships even if a future internal writer omits the admission helper. The shared private, fixed-search-path `sa_guard` helper obtains the existing provider transaction advisory lock and checks all actors' overlapping runs, using a fresh read after waiting. Public RPCs retain their current actor, role, generation, ownership, cursor and idempotency checks. Heartbeat returns `busy` on contention and can select the other due scope; it never starts a scope before its deadline.

The focused test now reproduces the original hour-long order retry and then successfully runs the actual inventory prepare/finish RPCs. Catalogue availability changes from stale to ready while the order remains pending with the exact same cooldown timestamp. Additional tests exercise the complete scope-pair overlap matrix, cross-actor admission, current generation/provider separation, terminal release, same-command replay, private-helper ACLs and concurrent manual/manual, manual/heartbeat and heartbeat/heartbeat admission. Six tests use real concurrent PostgreSQL connections and restore all captured synthetic fixture baselines; ordinary tests roll back. No provider HTTP is involved.

A fresh isolated rebuild through `94744` passed. **37/37 schedule/scope tests** and **290/290 affected warehouse, queue and cutover tests** passed with the actual `94123` watermark implementation installed. The inventory owner independently ran a broader 480-test suite including the same schedule/scope tests successfully. No provider or historical business data was used.

Provider cooldown remains attached to its existing job. Independent inventory freshness still cannot be guaranteed when the inventory provider itself fails or the workload exceeds available processing capacity.

The frozen `93125` migration was not edited. Two schedule test expectations were updated to the explicitly changed cross-scope behavior. A separate inventory watermark race (a callback arriving during GET or before the first cache row) is addressed by the inventory owner in `94123` and is not duplicated here.

## Checks with no additional blocker found

The Edge now leases exactly one job immediately before executing it, then checks its remaining invocation budget before another claim. This avoids consuming attempts on a batch of jobs that never starts. The current demand-driven five-second pump covers warehouse work as well as documents and other durable handlers. Expired leases and exhausted reconciliation children have a settlement path. These observations do not substitute for isolated-provider acceptance or claim sustained hosted throughput.
