# Prompt 1: foundation + payment spikes

Paste everything below the line into Claude Code (plan mode: Shift+Tab until "plan mode" shows).

---

We are building ALIVE for the Open Payments hackathon (final code due Sat 17 Oct 11:00). Read these fully before doing anything: `AGENTS.md` (product, rules, data model, scope tiers), `docs/ARCHITECTURE-BACKEND.md` (backend decisions D1–D13; where it is more specific than AGENTS.md, it wins), and `docs/OPEN-PAYMENTS.md` (SDK reference and known pitfalls).

**Goal of this task (Tier 0 foundation only):** scaffold the project and prove, against the real Interledger test wallet, that our payment design works. Do NOT build the DB, domain logic, routes or UI pages yet; that is the next prompt.

Environment: Windows 10, Node 24, PowerShell, VS Code. The repo will be public.

## Steps

1. **Scaffold** with `npx create-next-app@latest . --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm` (if the folder is not empty, scaffold in a temp folder and move the files in, keeping AGENTS.md, CLAUDE.md and docs/). Then install `@interledger/open-payments zod` and dev deps `tsx vitest`. Add scripts: `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `spike:s0`, `spike:s2` (`tsx --env-file=.env.local scripts/<file>.ts`).
2. **Config** (D11): `next.config.ts` with `serverExternalPackages: ['better-sqlite3', '@interledger/open-payments']`. `.gitignore` must cover `.env*` (except `.env.example`), `*.key`, `*.pem`, `*.db`. Create `.env.example` with empty values: `OP_WALLET_ADDRESS_URL, OP_KEY_ID, OP_PRIVATE_KEY, OP_PRIVATE_KEY_B64, APP_BASE_URL=http://localhost:3000, ENCRYPTION_KEY, STRICT_HASH=false, SPIKE_PAYER_WALLET, SPIKE_RECIPIENT_A_WALLET, SPIKE_RECIPIENT_B_WALLET`.
3. **`lib/env.ts`**: zod-validated env, fails fast with a readable message naming the missing variables. Require either `OP_PRIVATE_KEY` (path or PEM) or `OP_PRIVATE_KEY_B64`.
4. **`lib/money.ts`** + `lib/money.test.ts`: `type Amount = { value: string; assetCode: string; assetScale: number }`; `parseMinor`, `sum(amounts)` (BigInt; throws on asset mismatch), `lte`, `toDisplay(amount)` → "12.50 USD", `fromDecimalString("12.5", scale)` → "1250" (rejects too many decimals and negatives). No floats anywhere. Tests must pass.
5. **`lib/op/`** (server-only; add `import 'server-only'` to these files but NOT to anything the spike scripts import, or make the spikes import a non-guarded core; choose the simplest working approach and explain it):
   - `client.ts`: singleton `createAuthenticatedClient` cached on `globalThis` (D11, D12).
   - `wallet.ts`: `resolveWallet(url)` normalizes `$` → `https://` and returns `{ id, publicName, assetCode, assetScale, authServer, resourceServer }`.
   - `grants.ts`: `requestOutgoingGrant` (D1: no receiver, no interval, `identifier`, total `debitAmount` limit, `interact.finish` with nonce), `continueGrant`, `requestIncomingGrant` (`create`, `read`, `complete`), `requestQuoteGrant`, `rotateToken`, `verifyInteractHash` (D5).
   - `incoming.ts`, `quote.ts`, `outgoing.ts`: one thin function per SDK call. Fixed-debit quote per D2. `pollOutgoing` per D10.
   - `errors.ts`: `OpError` wrapping `OpenPaymentsClientError` (keep `status`, `code`, `description`, `validationErrors`).
   - Before writing each call, **open the installed type definitions** in `node_modules/@interledger/open-payments/dist/` and confirm the exact signatures and type guards (`isPendingGrant`, `isFinalizedGrantWithAccessToken`). If anything differs from our docs, follow the types and note the difference in `docs/spikes.md`.
6. **Spike S0** (`scripts/s0-single-payment.ts`): the full 8-step flow from payer to recipient A using `lib/op`, with a tiny `node:http` server on port 3344 for the callback. Print only ids, statuses and formatted amounts, plus the consent URL to open. Never print tokens or keys.
7. **Spike S1+S2+S5** (`scripts/s2-one-grant-many-payments.ts`): one outgoing grant with `debitAmount` limit = 3.00 (in the payer's asset), **no receiver**, approved via redirect. Wait ~15 s, rotate the token (S5), then make two payments with fixed-debit quotes (1.00 to recipient A, 2.00 to recipient B, open incoming payments) under that same grant, poll each to completion, and finally try a third 0.50 payment, which **must fail** for exceeding the limit. Report each outcome.
8. Create `docs/spikes.md` with a table: spike, result (PASS/FAIL/NOT RUN), evidence (ids), notes. Also update the S-table status in AGENTS.md §11.

## Rules
- Follow AGENTS.md §0 and §10 strictly: no secrets in the repo or in logs, no floats for money, strict TS with no `any`.
- **I will run the spikes myself** because they need my keys and a browser approval. Do not read `.env.local` or `*.key`. When the code is ready, give me the exact PowerShell commands and the `.env.local` values I need to fill in.
- Run `npm run typecheck`, `npm run lint` and `npm test` and fix everything before you finish.
- Make small commits in English imperative (`chore: scaffold next app`, `feat(op): add open payments client wrapper`, …). Do not push.
- If something blocks you (install failure, SDK shape mismatch), stop and tell me. Do not guess or work around it silently.

**First, show me your plan** (files, order, and any risks you see). Wait for my approval before writing code.
