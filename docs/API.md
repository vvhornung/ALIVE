# ALIVE API (v1, hackathon)

Contract for the frontend. Shapes are defined in [`lib/api/types.ts`](../lib/api/types.ts); import those types instead of re-declaring them.

## Conventions

- **Money** is always a `MoneyView`. `value` is an integer string in minor units; render `display`.
  ```json
  { "value": "30000", "assetCode": "USD", "assetScale": 2, "display": "300.00 USD" }
  ```
- **Amounts you send** are decimal **strings** (`"300.00"`, `"300"`). A JSON number is rejected with 400.
- **Dates** are `YYYY-MM-DD` on the Bogotá calendar (`dueAt` may be today in Bogotá, never earlier).
- **Errors** always look like this:
  ```json
  { "error": { "code": "ALLOCATION_EXCEEDS_TOTAL", "message": "Allocations add up to 30001 but the promise total is 30000 (minor units, USD)" } }
  ```
  | code | HTTP | when |
  |------|------|------|
  | `VALIDATION_ERROR` | 400 | bad body, bad amount/date, malformed wallet URL, no allocations at execute |
  | `WALLET_NOT_FOUND` | 400 | the wallet address could not be resolved |
  | `INVALID_HASH` | 400 | callback hash mismatch with `STRICT_HASH=true` |
  | `NOT_FOUND` | 404 | unknown promise or status token, **or missing/wrong freelancer key** |
  | `INVALID_APPROVAL_TOKEN` | 404 | unknown or wrong approval token |
  | `INVALID_STATE` | 409 | action not allowed in the current status (incl. "Payer authorization at risk") |
  | `ASSET_MISMATCH` | 422 | payer wallet currency/scale differs from the promise |
  | `ALLOCATION_EXCEEDS_TOTAL` | 422 | allocations add up to more than the promise |
  | `OP_ERROR` | 502 | the wallet provider (Open Payments) rejected a call |
  | `INTERNAL_ERROR` | 500 | anything else |

  `GRANT_LIMIT_EXCEEDED` never comes back as an HTTP error, because payment day runs in the background. It shows up as `payment.error` on an allocation: the payer's approval does not cover a retry.
- Every response sets `testMode: true` where relevant: the UI must say "test mode / play money".
- **No secrets in responses.** Responses never include grant tokens, nonces, continue/manage URIs or Open Payments resource URLs. The one exception is the records pack, which carries incoming/outgoing payment URLs as evidence. The approval token, freelancer key and dashboard URL are returned **once**, in the create response.

## Access model

| who | credential | where it lives |
|-----|------------|----------------|
| Freelancer | `freelancerKey` (256-bit, only its sha256 is stored) | header **`x-freelancer-key`** on every freelancer route |
| Payer | `approvalToken` | inside `approvalUrl` (`/approve/[approvalToken]`) |
| Recipient | status token | inside each `statusUrl` (`/status/[token]`) |

- Freelancer routes need the key: `GET /api/promises/[id]`, `POST …/allocations`, `POST …/execute`, `POST …/revoke-sim`, `GET …/events` and `GET …/records`. A missing or wrong key returns **404 `NOT_FOUND`**, the same as an unknown id.
- `dashboardUrl` is `${APP_BASE_URL}/dashboard/${id}#k=${freelancerKey}`. The `#k=` fragment never reaches the server. The dashboard page reads it with `location.hash`, keeps it (for example in `sessionStorage`) and sends it as the header.
- Because the records route needs the header, download the records pack with `fetch` + `Blob` instead of a plain `<a href>`.

## Statuses

- **Promise:** `draft → awaiting_approval → active → executing → completed | partially_failed | at_risk | expired`.
  - Retry: `partially_failed → executing`.
  - Out of and back into risk: `active ↔ at_risk`, via revoke-sim or a re-approval.
  - A new promise is returned already `awaiting_approval`.
- **Allocation:** `pending → paying → paid | failed`. A retry goes `failed → paying`.
- **Payment step** (latest attempt per allocation): `created → incoming_created → quoted → submitted → completed | failed`.

`atRisk` on a `PromiseView` is `null` unless the status is `at_risk`:

| `atRisk.reason` | meaning | how to recover |
|-----------------|---------|----------------|
| `simulated_revocation` | demo toggle (`simulated: true`) | `POST …/revoke-sim {"revoked": false}` |
| `grant_revoked` | the payer's wallet refused to refresh the authorization | payer approves again with the same approval link |
| `rotation_failed` | the authorization could not be refreshed (other error) | payer approves again with the same approval link |

---

## POST /api/promises

The freelancer creates a promise.

Request:
```json
{
  "freelancerWallet": "https://ilp.interledger-test.dev/ana",
  "freelancerName": "Ana Gómez",
  "amount": "300.00",
  "assetCode": "USD",
  "assetScale": 2,
  "dueAt": "2026-10-17",
  "description": "Logo design, October",
  "invoiceRef": "CC-2026-014"
}
```
Only `freelancerWallet`, `amount`, `assetCode` and `dueAt` are required. `assetScale` defaults to 2. The payer's wallet must use the same asset and scale; this is checked at `/authorize`. `freelancerName` defaults to the wallet's public name. `$ilp...` payment pointers are accepted.

Response `201`:
```json
{
  "promise": { "id": "6f1c2a9e-…", "status": "awaiting_approval", "...": "PromiseView" },
  "approvalUrl": "http://localhost:3000/approve/q3V0b2tlbi1leGFtcGxl…",
  "freelancerKey": "k3y-example-43-chars…",
  "dashboardUrl": "http://localhost:3000/dashboard/6f1c2a9e-…#k=k3y-example-43-chars…"
}
```
⚠ These values are returned **only here**. Redirect the freelancer to `dashboardUrl` right away.

## GET /api/promises/[id]  (key)

The freelancer view (`PromiseView`). Poll it every ~2 s while `status === "executing"`.
```json
{
  "id": "6f1c2a9e-…",
  "status": "executing",
  "atRisk": null,
  "freelancer": { "wallet": "https://ilp.interledger-test.dev/ana", "name": "Ana Gómez" },
  "payerWallet": "https://ilp.interledger-test.dev/acme-usd",
  "amount": { "value": "30000", "assetCode": "USD", "assetScale": 2, "display": "300.00 USD" },
  "allocated": { "value": "30000", "assetCode": "USD", "assetScale": 2, "display": "300.00 USD" },
  "unallocated": { "value": "0", "assetCode": "USD", "assetScale": 2, "display": "0.00 USD" },
  "dueAt": "2026-10-17",
  "description": "Logo design, October",
  "invoiceRef": "CC-2026-014",
  "allocations": [
    {
      "id": "0b8e…",
      "label": "Rent",
      "recipientWallet": "https://ilp.interledger-test.dev/landlord",
      "amount": { "value": "10000", "assetCode": "USD", "assetScale": 2, "display": "100.00 USD" },
      "status": "paid",
      "simulated": false,
      "statusUrl": "http://localhost:3000/status/Zm9vYmFy…",
      "payment": {
        "attempt": 1,
        "step": "completed",
        "debit": { "value": "10000", "assetCode": "USD", "assetScale": 2, "display": "100.00 USD" },
        "receive": { "value": "9900", "assetCode": "USD", "assetScale": 2, "display": "99.00 USD" },
        "error": null,
        "createdAt": "2026-10-17T15:00:01.000Z",
        "completedAt": "2026-10-17T15:00:04.000Z"
      }
    }
  ],
  "createdAt": "2026-10-16T20:15:03.120Z",
  "testMode": true
}
```
- `payment.debit` is what the payer is charged.
- `payment.receive` is what the quote says the recipient gets, after fees and FX, in the recipient's asset.
- `payment` is `null` until payment day starts for that allocation.

## GET /api/approve/[approvalToken]

Public info for the payer page at `/approve/[approvalToken]`.
```json
{
  "promiseId": "6f1c2a9e-…",
  "freelancerName": "Ana Gómez",
  "amount": { "value": "30000", "assetCode": "USD", "assetScale": 2, "display": "300.00 USD" },
  "dueAt": "2026-10-17",
  "description": "Logo design, October",
  "invoiceRef": "CC-2026-014",
  "status": "awaiting_approval",
  "reapprovalNeeded": false,
  "testMode": true
}
```
Offer "Approve" while `status === "awaiting_approval"` **or** `reapprovalNeeded === true`; in the second case the copy should be along the lines of "Your approval needs to be renewed". Otherwise, show "already approved".

Suggested copy (AGENTS §10.6): *"Pay 300.00 USD to Ana Gómez on 2026-10-17. You'll approve on your wallet's screen."* Avoid the words grant, GNAP and ILP, and don't call funds "reserved" or "guaranteed".

## POST /api/promises/[id]/authorize

The payer submits their wallet address.
```json
{ "approvalToken": "q3V0b2tlbi1leGFtcGxl…", "payerWallet": "https://ilp.interledger-test.dev/acme-usd" }
```
Response `200`: `{ "redirectUrl": "https://auth.interledger-test.dev/interact/…" }`. The frontend then does `window.location.href = redirectUrl`.

Errors:
- `ASSET_MISMATCH` (422): show the message as-is.
- `WALLET_NOT_FOUND` (400).
- `INVALID_STATE` (409): already approved.
- `VALIDATION_ERROR` (400): a re-approval coming from a different wallet.

A re-approval only asks the payer to cover the amount that is still unpaid.

## GET /api/grants/callback/[id]

Not called by the frontend. The payer's wallet redirects here after the consent screen. It always ends in a **302** to `/approve/[approvalToken]?result=approved|rejected|error`. After `rejected` or `error` the payer can try again.

## POST /api/promises/[id]/allocations  (key)

Replaces **all** allocations. Allowed while the promise is `draft`, `awaiting_approval` or `active`.
```json
{
  "allocations": [
    { "label": "Me", "recipientWallet": "https://ilp.interledger-test.dev/ana", "amount": "150.00" },
    { "label": "Rent", "recipientWallet": "https://ilp.interledger-test.dev/landlord", "amount": "100.00" },
    { "label": "PILA fund", "recipientWallet": "https://ilp.interledger-test.dev/pila-sim", "amount": "50.00", "simulated": true }
  ]
}
```
Response `200`: the updated `PromiseView`. Errors: `ALLOCATION_EXCEEDS_TOTAL` (422), `VALIDATION_ERROR` (400), `WALLET_NOT_FOUND` (400), `INVALID_STATE` (409). Label simulated parties as **simulated** in the UI.

## POST /api/promises/[id]/execute  (key)

"Simulate payment day". No body. It takes a lock and returns immediately; the payments run in the background.

Response **`202`**: `{ "status": "executing" }`. Then poll `GET /api/promises/[id]`:
- `executing` means it is still running. Each allocation's `payment.step` advances.
- `completed` means every allocation is `paid`.
- `partially_failed` means some allocation is not `paid`. Show `payment.error`. Calling execute again **retries**: failed allocations get a new attempt, and allocations still being confirmed are only re-checked, never paid twice.
- `at_risk` means the payer's authorization could not be refreshed (see `atRisk`). Nothing was paid in that run.

Errors:
- `409 INVALID_STATE`: it is already running, or `"Payer authorization at risk"`, or the promise is not approved yet.
- `400 VALIDATION_ERROR`: there are no allocations.

## POST /api/promises/[id]/revoke-sim  (key)

**Simulated** revocation for the demo. `{ "revoked": true }` moves `active → at_risk` (`atRisk: {reason: "simulated_revocation", simulated: true}`). `{ "revoked": false }` moves it back to `active`. Both are idempotent. It cannot clear a *real* `at_risk` (409). Response: `PromiseView`. Label it "simulated" in the UI.

## GET /api/promises/[id]/events  (key)

The timeline for the dashboard.
```json
{
  "events": [
    { "type": "promise_created", "at": "2026-10-16T20:15:03.120Z", "summary": "Promise created for 300.00 USD" },
    { "type": "payer_approved", "at": "2026-10-16T20:16:40.002Z", "summary": "Payer approved on their wallet" },
    { "type": "payment_quoted", "at": "2026-10-17T15:00:02.000Z", "summary": "Quote for Rent: payer pays 100.00 USD, recipient gets 99.00 USD" },
    { "type": "execution_completed", "at": "2026-10-17T15:00:12.000Z", "summary": "Payment day completed: 3 of 3 paid" }
  ]
}
```
Render `summary`; `type` is there for icons.

## GET /api/promises/[id]/records  (key)

A downloadable JSON "records pack" (`content-disposition: attachment`). Shape: `RecordsPack` in `lib/api/types.ts`. It contains the promise, the allocations, every payment attempt (amounts, timestamps, error, and the Open Payments incoming/outgoing payment URLs as evidence), the timeline, `testMode: true` and the disclaimer *"Records generated by ALIVE; not a legal or tax document."*

```js
const res = await fetch(`/api/promises/${id}/records`, { headers: { "x-freelancer-key": key } });
const url = URL.createObjectURL(await res.blob());
Object.assign(document.createElement("a"), { href: url, download: `alive-records-${id}.json` }).click();
```

## GET /api/status/[token]

The public, read-only status of one allocation, for the recipient page at `/status/[token]`.
```json
{
  "label": "Rent",
  "amount": { "value": "10000", "assetCode": "USD", "assetScale": 2, "display": "100.00 USD" },
  "status": "paid",
  "simulated": false,
  "freelancerName": "Ana Gómez",
  "dueAt": "2026-10-17",
  "payment": {
    "step": "completed",
    "recipientAmount": { "value": "9900", "assetCode": "USD", "assetScale": 2, "display": "99.00 USD" },
    "completedAt": "2026-10-17T15:00:04.000Z"
  },
  "testMode": true,
  "note": "Status reported by ALIVE's server. Test mode: play money on the Interledger test wallet."
}
```
Show `note`: the status is our server's claim, not something a third party verified.
