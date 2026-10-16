# ALIVE — Backend architecture (v1, hackathon)

Complements `AGENTS.md`. Where this file is more specific, it wins: it fixes gaps found when checking AGENTS.md against `@interledger/open-payments@7.4.0`.

## 1. Key design decisions (deltas vs AGENTS.md)

| # | Decision | Why |
|---|----------|-----|
| D1 | **One interactive grant per promise**, requested at approval: `outgoing-payment`, actions `['create','read','list']`, `identifier: payer.id`, `limits: { debitAmount: { value: total, assetCode: payer.assetCode, assetScale: payer.assetScale } }`, **no `receiver`, no `interval`**. | Lets one approval cover N payments to N recipients (spikes S1/S2). |
| D2 | **Payouts use fixed-debit quotes**: incoming payment created **without `incomingAmount`** (open), then `quote.create({ walletAddress: payer.id, receiver: incoming.id, method: 'ilp', debitAmount: allocation amount })`. | The sum of debits equals the promise total exactly, so it never exceeds the grant limit (fees are taken from the receive side). FX to recipients in other currencies (COP, MXN…) works automatically, so S4/S7 come almost for free. |
| D3 | **Promise amount is in the payer's asset.** At `/authorize`, if `payer.assetCode/assetScale` ≠ the promise's, return a 400 with a clear message. | Avoids a broken grant limit. Converting the promise currency is Tier 2. |
| D4 | **Callback URL carries the promise id in the path**: `${APP_BASE_URL}/api/grants/callback/[promiseId]`. The AS appends `?interact_ref=&hash=`. | The callback must find its pending grant; GNAP does not return your nonce. |
| D5 | **Persist the hash inputs**: `grant_client_nonce` (ours) and `grant_finish_nonce` (`interact.finish` returned by the AS). Verify `base64(sha256(clientNonce\nfinishNonce\ninteract_ref\npayer.authServer))`. On mismatch, log a warning and continue (demo) behind a `STRICT_HASH` flag. | Required by the spec. The test wallet behavior is not yet confirmed (spike). |
| D6 | **Rotate the token right before executing**: `client.token.rotate({ url: manage, accessToken })`, then persist the new `value` + `manage` (encrypted). If rotation fails, the promise goes to `at_risk`. | Access tokens live about 10 min. "Payment day" will be later than approval. |
| D7 | **The quote grant is non-interactive** on the payer's AS (`quote` `['create','read']`), requested at execution time and not stored. | Least privilege, nothing long-lived. |
| D8 | **Execution lock**: `UPDATE promises SET status='executing' WHERE id=? AND status='active'`. If 0 rows change, return 409. | Prevents a double click from paying twice. |
| D9 | **Resume per step**: each payment row stores `incoming_payment_url → quote_id → outgoing_payment_url`. On retry, skip the steps already done. **Never create a 2nd outgoing payment** if `outgoing_payment_url` is set. | AGENTS §10.4 idempotency, made concrete. |
| D10 | **Poll** `outgoingPayment.get` **and** `incomingPayment.get` every 1.5 s, up to 30 s. **Completed** when `BigInt(incoming.receivedAmount.value) >= BigInt(quote.receiveAmount.value)`; **failed** when `outgoing.failed === true`; neither after 30 s → **timeout**. Then `incomingPayment.complete` (best-effort; needs the `complete` action on the incoming grant). _Pending confirmation in spike S0_ (the spikes print sentAmount, debitAmount, receiveAmount and receivedAmount on every attempt). | Gives the "completed" step the demo requires. Comparing `sentAmount` with `debitAmount` is unreliable with fixed-debit quotes if the wallet charges sending fees. |
| D11 | **Next.js specifics**: route handlers `export const runtime = 'nodejs'`; `next.config` `serverExternalPackages: ['better-sqlite3', '@interledger/open-payments']`; **`cacheComponents` and `partialPrefetching` are OFF** (create-next-app 16 turns them on, but Cache Components forbids any `runtime` export, and its prerender heuristics cannot see synchronous better-sqlite3 reads, so a handler could be prerendered with stale data); the OP client and the DB are **singletons on `globalThis`** (survives hot reload); route `params` are async (`await params`). | Most common source of lost hours with Next + native/Node-only libs. Classic request-time route handlers are the simplest model for a hackathon. |
| D12 | **Private key from env**: `OP_PRIVATE_KEY` accepts a file path, a PEM string, or base64 (`OP_PRIVATE_KEY_B64`). | Local path for dev, base64 for any host. |
| D13 | **SQLite**: `better-sqlite3`. If the native install fails on Windows, fall back to Node's built-in `node:sqlite` (Node 24 has it) behind the same `lib/db` interface. | Removes a Windows build risk. |

## 2. Layers

```
app/api/**/route.ts     thin: zod-parse input → call lib/domain → map typed errors to HTTP
lib/domain/             business rules + state machines; the only writer of statuses; appends events
  promises.ts           create, startAuthorization, completeAuthorization, markAtRisk
  allocations.ts        replaceAllocations (BigInt sum ≤ total)
  payout.ts             executePromise → runAllocation (resumable pipeline, D8–D10)
  errors.ts             DomainError(code, httpStatus, message)
lib/op/                 the ONLY place that imports @interledger/open-payments
  index.ts              barrel with `import 'server-only'`. **The app imports ONLY from '@/lib/op'.**
                        The other lib/op files have no guard so spike scripts (plain Node via tsx)
                        import the concrete files (e.g. '../lib/op/grants'). Never import the barrel from scripts.
  client.ts             singleton createAuthenticatedClient (D11, D12)
  wallet.ts             resolveWallet(url): normalizes $ → https://, returns {id, assetCode, assetScale, authServer, resourceServer}
  grants.ts             requestOutgoingGrant, continueGrant, requestIncomingGrant, requestQuoteGrant, rotateToken, verifyInteractHash
  incoming.ts / quote.ts / outgoing.ts   one function per call + wrapOpError → OpError
lib/db/                 schema.sql, migrate.ts, queries.ts (typed; no SQL outside this folder)
lib/crypto.ts           AES-256-GCM encrypt/decrypt for stored tokens (ENCRYPTION_KEY = 32 bytes base64)
lib/money.ts            parse/format/sum with BigInt; toDisplay(value, scale); never floats
lib/env.ts              zod-validated env, fails fast at boot
scripts/                spikes s0..s7 (tsx), results in docs/spikes.md
```

## 3. Schema additions to AGENTS §7

```sql
-- promises
ALTER: grant_client_nonce TEXT, grant_finish_nonce TEXT,   -- D5
       freelancer_name TEXT, approval_token TEXT UNIQUE    -- public approval link uses this, not the id
-- payments
ALTER: attempt INTEGER NOT NULL DEFAULT 1,
       debit_value TEXT, receive_value TEXT, receive_asset_code TEXT, receive_asset_scale INTEGER, -- from quote (records pack + UI)
       step TEXT NOT NULL  -- created|incoming_created|quoted|submitted|completed|failed  (D9)
```
Tokens (`grant_continue_token`, `grant_access_token`, `grant_manage_uri`, `grant_continue_uri`) are stored **encrypted**.

## 4. Sequence

**Approval**
```
POST /api/promises/[id]/authorize {payerWallet}
  → resolveWallet(payer) → check asset (D3)
  → grant.request(payer.authServer, outgoing grant D1, interact.finish{uri: callback/[id], nonce})
  → store continue uri/token + nonces (encrypted) → status awaiting_approval → return {redirectUrl}
GET /api/grants/callback/[id]?interact_ref&hash
  → no interact_ref ⇒ event payer_rejected, redirect /approve/[token]?result=rejected
  → verify hash (D5) → grant.continue → isFinalizedGrantWithAccessToken
  → store access token + manage (encrypted) → status active → redirect to a success page
```
**Payment day**
```
POST /api/promises/[id]/execute
  → lock (D8) → rotate token (D6) → quote grant (D7)
  → for each pending allocation, sequentially: runAllocation (resume D9)
       recipient = resolveWallet → incoming grant (recipient AS) → incomingPayment.create (open, metadata)
       → quote.create (debitAmount, D2) → outgoingPayment.create {walletAddress: payer.id, quoteId}
       → poll (D10) → allocation paid|failed
  → promise completed | partially_failed
```

## 5. Spike order (blocking)
S0 (single full payment) → S1+S2 together (grant without receiver, 2 outgoing payments with fixed-debit quotes to 2 recipients under one grant) → S5 (rotate after approval) → S4 (cross-currency recipient). If S2 fails, fall back to one approval per allocation at execution time (AGENTS §11).

## 6. Team split (after prompt 1)
- **Backend A (payments)**: lib/op + spikes → payout pipeline.
- **Backend B (data)**: lib/db, lib/domain, routes, tests.
- **Frontend**: /approve, /dashboard, /status against mocked API JSON (shapes from §8 of AGENTS).
- **Pitch/QA**: test wallets (payer USD, freelancer, landlord, designer, "PILA fund" simulated), slides, demo recording.
