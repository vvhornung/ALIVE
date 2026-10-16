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
  | `VALIDATION_ERROR` | 400 | bad body, bad amount/date, malformed wallet URL |
  | `WALLET_NOT_FOUND` | 400 | the wallet address could not be resolved |
  | `INVALID_HASH` | 400 | callback hash mismatch with `STRICT_HASH=true` |
  | `NOT_FOUND` | 404 | unknown promise id or status token |
  | `INVALID_APPROVAL_TOKEN` | 404 | unknown or wrong approval token |
  | `INVALID_STATE` | 409 | action not allowed in the current status |
  | `ASSET_MISMATCH` | 422 | payer wallet currency/scale differs from the promise |
  | `ALLOCATION_EXCEEDS_TOTAL` | 422 | allocations add up to more than the promise |
  | `OP_ERROR` | 502 | the wallet provider (Open Payments) rejected a call |
  | `INTERNAL_ERROR` | 500 | anything else |
- Every response sets `testMode: true` where relevant: the UI must say "test mode / play money".
- **No secrets ever appear in responses**: no grant tokens, nonces or continue/manage URIs. The approval token only appears inside `approvalUrl` in the create response.
- **Access model (hackathon, no auth):** the promise `id` (a UUID) works as the freelancer's key. Anyone who has it can read the promise and replace its allocations. The payer page receives `promiseId` because it needs it to call `/authorize`. Status and approval tokens are 256-bit random values.

## Promise statuses

`draft → awaiting_approval → active → executing → completed | partially_failed | at_risk | expired`.
A new promise is returned already `awaiting_approval`. Allocation statuses: `pending → paying → paid | failed`.

---

## POST /api/promises

The freelancer creates a promise. The response includes the link to send to the payer.

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
  "promise": {
    "id": "6f1c2a9e-1d7b-4c55-9a0e-3b7f0f2a8c11",
    "status": "awaiting_approval",
    "freelancer": { "wallet": "https://ilp.interledger-test.dev/ana", "name": "Ana Gómez" },
    "payerWallet": null,
    "amount": { "value": "30000", "assetCode": "USD", "assetScale": 2, "display": "300.00 USD" },
    "allocated": { "value": "0", "assetCode": "USD", "assetScale": 2, "display": "0.00 USD" },
    "unallocated": { "value": "30000", "assetCode": "USD", "assetScale": 2, "display": "300.00 USD" },
    "dueAt": "2026-10-17",
    "description": "Logo design, October",
    "invoiceRef": "CC-2026-014",
    "allocations": [],
    "createdAt": "2026-10-16T20:15:03.120Z",
    "testMode": true
  },
  "approvalUrl": "http://localhost:3000/approve/q3V0b2tlbi1leGFtcGxlLW5vdC1yZWFsLWp1c3Qtc2hhcGU"
}
```
The approval URL is only returned here. Store it in the freelancer UI if you need to show it again.

## GET /api/promises/[id]

The freelancer view. Returns a `PromiseView` with the same shape as `promise` above. Once allocations exist:
```json
{
  "...": "...",
  "status": "active",
  "payerWallet": "https://ilp.interledger-test.dev/acme-usd",
  "allocated": { "value": "30000", "assetCode": "USD", "assetScale": 2, "display": "300.00 USD" },
  "unallocated": { "value": "0", "assetCode": "USD", "assetScale": 2, "display": "0.00 USD" },
  "allocations": [
    {
      "id": "0b8e…",
      "label": "Rent",
      "recipientWallet": "https://ilp.interledger-test.dev/landlord",
      "amount": { "value": "10000", "assetCode": "USD", "assetScale": 2, "display": "100.00 USD" },
      "status": "pending",
      "simulated": false,
      "statusUrl": "http://localhost:3000/status/Zm9vYmFy…"
    }
  ]
}
```
`statusUrl` is the link the freelancer shares with that recipient.

## GET /api/approve/[approvalToken]

Public info for the payer page at `/approve/[approvalToken]`.

Response `200`:
```json
{
  "promiseId": "6f1c2a9e-1d7b-4c55-9a0e-3b7f0f2a8c11",
  "freelancerName": "Ana Gómez",
  "amount": { "value": "30000", "assetCode": "USD", "assetScale": 2, "display": "300.00 USD" },
  "dueAt": "2026-10-17",
  "description": "Logo design, October",
  "invoiceRef": "CC-2026-014",
  "status": "awaiting_approval",
  "testMode": true
}
```
The page should only offer "Approve" while `status === "awaiting_approval"`. When `status === "active"` it should show "already approved".

Suggested copy (AGENTS §10.6): *"Pay 300.00 USD to Ana Gómez on 2026-10-17. You'll approve on your wallet's screen."* Avoid the words grant, GNAP and ILP, and don't call funds "reserved" or "guaranteed".

## POST /api/promises/[id]/authorize

The payer submits their wallet address. The server requests the approval from the payer's wallet.

Request:
```json
{ "approvalToken": "q3V0b2tlbi1leGFtcGxlLW5vdC1yZWFsLWp1c3Qtc2hhcGU", "payerWallet": "https://ilp.interledger-test.dev/acme-usd" }
```
Response `200`:
```json
{ "redirectUrl": "https://auth.interledger-test.dev/interact/…" }
```
The frontend then does `window.location.href = redirectUrl`. Typical errors: `ASSET_MISMATCH` (422), where you show the message as-is; `WALLET_NOT_FOUND` (400); `INVALID_STATE` (409) when the promise is already approved.

## GET /api/grants/callback/[id]

Not called by the frontend. The payer's wallet redirects the browser here after the consent screen. It always ends in a **302** to the approval page:

| outcome | redirect |
|---------|----------|
| approved | `/approve/[approvalToken]?result=approved` |
| payer declined (no `interact_ref`) | `/approve/[approvalToken]?result=rejected` |
| anything failed | `/approve/[approvalToken]?result=error` |

The `/approve` page should read `?result=` and show a success, "you declined" or "something went wrong, try again" message. After `rejected` or `error` the promise is still `awaiting_approval`, so the payer can try again.

## POST /api/promises/[id]/allocations

Replaces **all** allocations. Allowed while the promise is `draft`, `awaiting_approval` or `active`. Amounts are in the promise's asset. The sum may be less than the total but never more. Sending an empty list clears the allocations.

Request:
```json
{
  "allocations": [
    { "label": "Me", "recipientWallet": "https://ilp.interledger-test.dev/ana", "amount": "150.00" },
    { "label": "Rent", "recipientWallet": "https://ilp.interledger-test.dev/landlord", "amount": "100.00" },
    { "label": "PILA fund", "recipientWallet": "https://ilp.interledger-test.dev/pila-sim", "amount": "50.00", "simulated": true }
  ]
}
```
Response `200`: the updated `PromiseView`. Errors: `ALLOCATION_EXCEEDS_TOTAL` (422), `VALIDATION_ERROR` (400, for example too many decimals), `WALLET_NOT_FOUND` (400), `INVALID_STATE` (409, once executing).

Label simulated parties as **simulated** in the UI.

## GET /api/status/[token]

Public, read-only status of one allocation, for the recipient page at `/status/[token]`.

Response `200`:
```json
{
  "label": "Rent",
  "amount": { "value": "10000", "assetCode": "USD", "assetScale": 2, "display": "100.00 USD" },
  "status": "pending",
  "simulated": false,
  "freelancerName": "Ana Gómez",
  "dueAt": "2026-10-17",
  "testMode": true,
  "note": "Status reported by ALIVE's server. Test mode: play money on the Interledger test wallet."
}
```
Show `note`: the status is our server's claim, not something a third party verified.

## Not yet available

`POST /api/promises/[id]/execute` (payment day) and `POST /api/promises/[id]/revoke-sim` come in the next backend prompt.
