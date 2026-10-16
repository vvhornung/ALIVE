# ALIVE — Technical Context & Agent Guide

> Tagline: *"Your invoice isn't a PDF. It's live money."*
> Project for the Open Payments Hackathon, Ruta N, Medellín, 16–17 Oct 2026.
> This file is the single source of truth for humans and coding agents working on this repo. Read it fully before writing code.

---

## 0. How agents must behave in this repo

1. **Never invent Open Payments API shapes.** Every call in §4 and §5 is marked `VERIFY`. Check it against https://openpayments.dev docs and the official `@interledger/open-payments` SDK types/examples before using it. If docs and this file disagree, docs win, and you update this file.
2. **Keep scope small.** Build in the order of §12. Do not add features from a later tier until the earlier tier works end to end.
3. **One working payment beats ten half-built features.** The hackathon requires a working Open Payments flow shown in a demo.
4. **Never put secrets in the repo.** The repo must be PUBLIC for judging. Private keys, key IDs and tokens live in `.env.local` only (gitignored). Commit `.env.example` with empty values.
5. **Be honest in code, UI copy and docs.** See §3: a grant is an authorization, not funds. Do not write UI text that implies money is reserved or guaranteed.
6. **Small, reviewable changes.** One concern per commit, run `npm run typecheck && npm run lint` before committing.
7. **When blocked by an unknown, stop and report it** (see §11 spikes) instead of guessing.

---

## 1. Context

- **Event:** Open Payments Hackathon (Interledger Foundation), Ruta N, Medellín.
  - Fri 16 Oct: hacking 10:30–14:00 and 15:00–17:30.
  - Sat 17 Oct: hacking 08:00–11:00. **Final code and presentation due Sat 11:00.** Round 1 judging 12:00.
  - Teams may keep building from home overnight.
- **Hard requirements:**
  - Must integrate the Open Payments API, or the project is not eligible for judging or prizes.
  - GitHub repository must be **public**.
  - Submission: slides, demo link, public repo link. The demo must **show a working, recorded payment flow**: payment request, authorization, payment execution, successful completion.
- **Judging criteria:** problem definition, use of Open Payments (working flow), user experience, technical quality (works reliably), presentation, innovation, inclusion, impact.
- **Awards we target:** Ruta N Impact, FIND Innovation, Puntored Financial Inclusion, Community Award (voted by all attendees).
- **Tip from organizers:** a simple idea that works beats a large project that tries to do too much.

---

## 2. Product description

**Problem.** In Colombia, a freelancer's or contractor's invoice (*cuenta de cobro*) is not usable money until the client pays, often 30–60 days later. Paying overseas clients is slow, fees are unclear, and paperwork is heavy. Freelancers often need to pay obligations (social security *PILA*, rent, subcontractors) before they are paid.

**Solution (ALIVE).** A business (the *payer*) approves a payment commitment for a freelancer using an Open Payments interactive grant. The freelancer's app then **allocates** that commitment across recipients (self, PILA fund, landlord, subcontractor) and, on the due date, **automates the payments from the payer's wallet directly to each recipient's wallet**, in the payer's currency or the recipient's, with the quote shown before anything is sent.

**Users**
- **Payer (business, overseas):** approves one commitment on a consent screen. Needs a wallet at a provider that supports Open Payments (test wallet in the hackathon).
- **Freelancer (Colombia):** creates the promise, defines allocations, monitors status.
- **Recipients (landlord, subcontractor, PILA fund):** view a status page for what they are owed and when.

**Roadmap beyond the hackathon (stretch, do not build first):** reusable payer approvals for recurring contracts, webhooks/dev API so other apps can create promises and receive payout events, records pack export (invoice + quote + timestamps + confirmation) for the freelancer's accountant.

---

## 3. Core concept and honest framing (READ THIS)

- A **grant is permission, not money.** It authorizes our app to debit the payer's wallet within agreed limits. It does **not** reserve or guarantee funds, and the payer's wallet/provider can revoke it.
- Every outgoing payment debits the **payer's** balance. If funds are missing on payment day, payments fail.
- Grants and tokens are **not transferable or splittable.** "Dividing the promise" means rows in OUR database (the *allocations* table). Our server holds the grant and executes one payment per allocation.
- "One payment split" is not a thing: Open Payments creates **one outgoing payment per receiving wallet**. Say "one approval, many payments".
- **Advancing money today** (e.g., paying the PILA before the client pays) is lending/factoring. In this prototype the "PILA fund" is a **simulated partner**. UI and slides must label it as simulated.
- The status page showing a promise as "active" is **our server's claim**, not something a third party verifies independently. Word UI copy accordingly.
- **Legal/tax:** we do not provide legal compliance. We provide clean timestamped records. Do not make claims about DIAN, foreign exchange or tax compliance in code or UI.
- Hackathon runs on the **Interledger test wallet with play money**. Say so in the demo.

---

## 4. Open Payments primer (from the official guide)

Open Payments sits at the application layer of the Interledger stack. We never touch ILP/STREAM/connectors; ILP delivers the payment when an outgoing payment is created.

Resources and concepts:
- **Wallet address:** URL identifying an account, e.g. `https://wallet.example.com/alice`. Querying it returns supported asset, public metadata, and the URLs of the auth server and resource server.
- **Grant (GNAP):** permission scoped to a resource type and actions. Returns an access token. Incoming-payment and quote grants are negotiated non-interactively. **Outgoing-payment grants are interactive** (user consent out of band).
- **Incoming payment:** resource on the **receiver's** wallet describing what they will receive (optional amount, expiry, description, metadata). Can be created before the sender knows about it.
- **Quote:** resource on the **sender's** wallet fixing sender debit amount, fees and receiver amount before anything is sent. Can exist without a payment.
- **Outgoing payment:** resource on the sender's wallet that debits the sender and sends funds over Interledger. Requires an interactive grant.

Standard peer-to-peer flow (8 steps; each step is its own resource):
1. Discover wallet capabilities (GET wallet address).
2. Request incoming-payment grant from the **recipient's** auth server (non-interactive).
3. Create incoming payment on the recipient's wallet (amount, expiry, metadata such as an order/invoice id).
4. Request quote grant from the **sender's** auth server (non-interactive).
5. Create quote on the sender's wallet referencing the incoming payment URL.
6. Request **interactive** outgoing-payment grant from the sender's auth server. User approves on the wallet's consent screen. App receives an access token after the redirect.
7. Create outgoing payment referencing the quote.
8. Monitor status through the resources (received, fully delivered, completed times).

---

## 5. Architecture

```
 Payer browser ──(1) approval link──► ALIVE web (Next.js)
                                        │  /approve/[promiseId]
                                        ▼
                              ALIVE API routes (Node)
                                │       │        └──► SQLite (promises, allocations, payments, events)
                                │       └─► lib/op  (Open Payments client wrapper, server only)
                                ▼
         Payer's wallet (auth + resource server)   Recipient wallets (auth + resource servers)
         · interactive outgoing grant              · incoming-payment grant + incoming payment
         · quote, outgoing payment

 Freelancer browser ──► /dashboard (create promise, allocations, run payout, status)
 Recipient browser  ──► /status/[token]   (read-only)
```

**Modules (suggested layout)**
```
/app                 Next.js app router pages
  /approve/[id]      payer approval landing page (hides GNAP jargon)
  /dashboard         freelancer UI
  /status/[token]    public read-only status per allocation
  /api/...           route handlers (see §8)
/lib
  /op                Open Payments wrapper: client.ts, wallet.ts, grants.ts, incoming.ts, quote.ts, outgoing.ts
  /db                schema.sql, queries.ts (better-sqlite3)
  /domain            promises.ts, allocations.ts, payout.ts (business rules, no HTTP)
  /money.ts          amount helpers (integer strings + assetScale, never floats)
  /env.ts            validated env access (zod)
/scripts             spike scripts (one file per unknown in §11)
AGENTS.md
```

**Rule of separation:** route handlers are thin; business logic in `lib/domain`; all Open Payments calls only in `lib/op`. The browser never receives tokens, keys or grant continuation data.

---

## 6. Stack

- **Language:** TypeScript (strict).
- **Framework:** Next.js (app router) with Node route handlers. A separate Express service is acceptable only if the team prefers; keep one deployable.
- **Open Payments:** official JS SDK `@interledger/open-payments` (Node). Official SDKs exist for JavaScript, PHP and Rust; use JS.
- **DB:** SQLite via `better-sqlite3` (single file, no setup). Migrations as plain SQL.
- **Validation:** `zod`. **UI:** Tailwind. **Testing:** Vitest for `lib/domain` and `lib/money` (at least the allocation-sum and state-transition logic).
- **Runtime config:** `.env.local` with: `OP_WALLET_ADDRESS_URL` (our app's wallet address used to authenticate the client), `OP_KEY_ID`, `OP_PRIVATE_KEY` (path or PEM; Ed25519 developer key generated in the test wallet), `APP_BASE_URL`, `ENCRYPTION_KEY` (to encrypt stored tokens at rest, even for the prototype).
- **Test wallet:** Interledger test wallet. Create accounts: payer (USD), freelancer, PILA fund (simulated), landlord, subcontractor. Generate developer keys per the docs.
- **Hosting for demo:** local or any simple host. Do not expose real secrets.

---

## 7. Data model (SQLite)

```sql
CREATE TABLE promises (
  id TEXT PRIMARY KEY,                 -- uuid
  freelancer_wallet TEXT NOT NULL,     -- wallet address URL
  payer_wallet TEXT,                   -- set at approval
  asset_code TEXT NOT NULL,            -- payer debit asset, e.g. USD
  asset_scale INTEGER NOT NULL,
  total_value TEXT NOT NULL,           -- integer string in minor units
  due_at TEXT NOT NULL,                -- ISO date
  description TEXT,
  invoice_ref TEXT,
  status TEXT NOT NULL,                -- see §9
  grant_continue_uri TEXT,             -- encrypted/opaque, server only
  grant_continue_token TEXT,           -- encrypted
  grant_access_token TEXT,             -- encrypted
  grant_manage_uri TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE allocations (
  id TEXT PRIMARY KEY,
  promise_id TEXT NOT NULL REFERENCES promises(id),
  label TEXT NOT NULL,                 -- 'PILA', 'Rent', 'Designer', 'Me'
  recipient_wallet TEXT NOT NULL,
  value TEXT NOT NULL,                 -- integer string, same asset as promise unless FX enabled
  status TEXT NOT NULL,                -- pending|paying|paid|failed
  status_token TEXT NOT NULL UNIQUE,   -- random token for public status page
  simulated INTEGER NOT NULL DEFAULT 0 -- 1 for the simulated PILA fund
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  allocation_id TEXT NOT NULL REFERENCES allocations(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  incoming_payment_url TEXT,
  quote_id TEXT,
  outgoing_payment_url TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE events (                  -- append-only audit log for the records pack
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promise_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  at TEXT NOT NULL
);
```
Invariant: `SUM(allocations.value) <= promises.total_value`. Enforce in `lib/domain`, not only in the UI.

---

## 8. API routes (thin handlers)

| Route | Purpose |
|---|---|
| `POST /api/promises` | Freelancer creates a promise (amount, due date, description, payer email optional). Returns approval link. |
| `GET /api/promises/[id]` | Promise with allocations and payment states (freelancer view). |
| `POST /api/promises/[id]/authorize` | Payer submits wallet address. Server resolves it, requests the interactive outgoing-payment grant, returns redirect URL. |
| `GET /api/grants/callback` | Return from consent screen (`interact_ref`). Server continues the grant, stores token (encrypted), sets status `active`. |
| `POST /api/promises/[id]/allocations` | Add/replace allocations; validates sum. |
| `POST /api/promises/[id]/execute` | "Payment day": for each pending allocation run the pipeline in §10.4. Idempotent. |
| `POST /api/promises/[id]/revoke-sim` | Simulated revocation toggle for the demo (marks promise at-risk). |
| `GET /api/status/[token]` | Public read-only status for one allocation. |

---

## 9. State machines

**Promise:** `draft → awaiting_approval → active → executing → completed | partially_failed | at_risk | expired`
**Allocation:** `pending → paying → paid | failed`
**Payment:** `created → quoted → authorized → submitted → completed | failed`

Transitions only through functions in `lib/domain`. Every transition appends a row to `events`.

---

## 10. Programming rules

### 10.1 General
- TypeScript strict, no `any` unless commented with reason. Prefer small pure functions.
- Fail loudly with typed errors; never swallow errors from Open Payments calls. Store the error message on the `payments` row.
- No `console.log` of tokens, keys, grant data or full wallet responses. Log ids and statuses only.

### 10.2 Money
- Amounts are **integer strings in minor units** plus `assetCode` and `assetScale`, exactly as Open Payments represents them. **Never use floating point.** Use `BigInt` for arithmetic.
- Always display amounts formatted from value+scale. Show the **quote** (payer debit, fees, receiver amount) before payer consent where possible.

### 10.3 Open Payments usage
- Create **one authenticated client** (`createAuthenticatedClient`) in `lib/op/client.ts`, server only. `VERIFY` constructor options against the SDK version installed.
- Resolve wallet addresses with the client's wallet-address get call, then use the returned `authServer` and `resourceServer` URLs. Never hardcode them.
- Request only the access types and actions needed (least privilege). `VERIFY` grant request shape and limits (`debitAmount`, `receiveAmount`, `interval`) in the docs.
- Respect token expiry; use the token management URL to rotate when supported. `VERIFY`.
- Treat each step as a separate resource and persist the ids/URLs after each step so a retry can resume instead of repeating.
- Interactive grant redirect: generate a `nonce`, store it, and validate on callback. `VERIFY` the finish/redirect parameters.

### 10.4 Payout pipeline (per allocation, on payment day)
1. Check promise status is `active` and not revoked; check token still valid.
2. Resolve recipient wallet address.
3. Request incoming-payment grant on the **recipient's** auth server.
4. Create incoming payment on the recipient's wallet (amount = allocation value; `metadata` includes `promiseId`, `allocationId`, `invoiceRef`).
5. Request quote grant on the **payer's** auth server (cache while valid).
6. Create quote referencing the incoming payment URL. If the quote expired, re-quote and record the new amounts in `events`.
7. Create outgoing payment with the stored interactive-grant token and the quote id.
8. Poll the outgoing payment until completed or failed; update `payments`, `allocations`, `events`.
- **Idempotency:** `payments.idempotency_key = promiseId:allocationId:attempt`. Before creating anything, look up existing `payments` and resume from the last persisted step. Never create a second outgoing payment for an allocation that has one submitted.
- Process allocations **sequentially** at first (simpler to debug); parallelize only if time remains.

### 10.5 Security
- Public repo: no secrets, no real personal data, no real wallet credentials.
- Status tokens are random (≥128 bits), unguessable, and expose only the one allocation.
- Encrypt stored grant tokens at rest with `ENCRYPTION_KEY`.
- Do not trust client input for amounts or wallet URLs; validate with `zod` and re-verify server-side.

### 10.6 UX copy rules
- Payer page: plain language. "Pay $X to [Freelancer] on [date]. You'll approve on your wallet's screen." Do not show "GNAP", "grant", "ILP".
- Always state test-mode ("play money") in the demo UI.
- Label simulated parties (PILA fund) as "simulated".
- Never say funds are "reserved" or "guaranteed".

### 10.7 Git and quality
- Branches per feature, PRs/commits small, messages in English, imperative.
- Unit tests for: allocation sum invariant, state transitions, money helpers, idempotency resume logic.
- README must explain: problem, user, solution, how Open Payments is used, how to run, demo link. Add an architecture diagram (this file's diagram is fine).

---

## 11. Spikes: unknowns to resolve FIRST (scripts in `/scripts`)

Each spike = one small script that proves or disproves one thing against the test wallet. Report results in `docs/spikes.md`. Ask mentors (help desk / Slack) in parallel.

| # | Question | If NO, fallback |
|---|---|---|
| S0 | One full payment end to end (all 8 steps) works with our keys. | Nothing else matters until this works. |
| S1 | Can an interactive outgoing grant be created **before** quotes exist, with generic limits (no fixed receiver), and then be used later? | Create grant with limits matching one pre-created quote per allocation, or run approval at payment time. |
| S2 | Can **several outgoing payments** run under one grant/token (limits: total `debitAmount`)? | One grant per allocation, or approve at execution time. |
| S3 | Does a **future start date / interval** work in grant limits? | Server holds the token and only executes on the due date. Demo looks identical. |
| S4 | **USD → COP** (or other asset) conversion between test accounts? | Demo in a single asset; mention FX as next step. |
| S5 | How long do access tokens live; can they be rotated? | Re-approval flow or short demo window. |
| S6 | Does the payer's wallet expose revocation we can detect (grant state)? | Keep `revoke-sim` toggle, clearly labeled simulated. |
| S7 | Can the freelancer's COP wallet receive from a USD payer in the test wallet? | Show both sides in USD, mention COP next. |

---

## 12. Scope tiers (build in this order; stop adding when time is short)

- **Tier 0 (must, by Fri ~14:00):** S0 passes. Promise created, payer approves via interactive grant, callback stores token.
- **Tier 1 (must, by Fri ~17:30):** allocations (3 recipients), "Execute payment day" runs the pipeline, public status page, recorded demo flow.
- **Tier 2 (evening/Sat morning):** FX (if S4 OK), simulated revocation alert, event timeline, records pack export (JSON/PDF) per promise.
- **Tier 3 (only if everything is stable):** scheduler (cron) for the due date, recurring approvals, webhook/dev API.
- **Cut order if time runs out:** scheduler → FX → revocation alert → polish. **Never cut** approval + allocation + payment day.

Timeline: Sat 08:00–11:00 is for testing the flow twice, recording the demo, README, slides, pushing to the public repo. **Submit by Sat 11:00.**

---

## 13. Demo script (3 minutes) and definition of done

1. Payer in Miami opens the approval link and approves (consent screen).
2. Freelancer sees the active promise and allocates three parts (self / rent / designer; PILA fund shown as simulated).
3. Click **Simulate payment day**.
4. Show each payment completing in the test wallets and the status pages updating.
5. (If built) trigger simulated revocation and show the at-risk alert.
6. Close: "Your invoice isn't a PDF. It's live money."

**Done =** a recorded run showing request → authorization → execution → completion; public repo with README and no secrets; slides covering challenge, user, solution, how Open Payments is used, key learnings.

---

## 14. Dev tools and resources

- Open Payments docs: openpayments.dev (API reference, guides, SDK examples).
- Official SDKs and example repositories: JavaScript, PHP, Rust (linked from the docs).
- Interledger test wallet (create accounts, developer keys).
- Interledger community Slack: ask in the hackathon channel; mentors at the help desk.
- Free Open Payments course on Platzi (optional background).
- Reference repo discussed by the team (tourism payments app, Flutter): useful for UI ideas (payment links/QR, quote screen, exports), **not** as an API reference.

## 15. Glossary

**Wallet address:** URL of an account. **GNAP:** protocol for negotiating grants. **Grant:** scoped permission returning an access token. **Incoming payment / Quote / Outgoing payment:** the three payment resources. **Interactive grant:** needs user consent out of band. **Allocation:** our own database row dividing a promise; not part of Open Payments. **PILA:** Colombian social-security contribution form/payment. **Cuenta de cobro:** freelancer invoice document in Colombia.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
