// Typed queries. The only place with SQL. Grant secrets are encrypted here on
// write and only leave through getPendingGrant/getActiveGrant; the regular
// row readers never select them.
import { decrypt, encrypt } from "@/lib/crypto";
import { getDb } from "./connection";

export type PromiseStatus =
  | "draft"
  | "awaiting_approval"
  | "active"
  | "executing"
  | "completed"
  | "partially_failed"
  | "at_risk"
  | "expired";

export type AllocationStatus = "pending" | "paying" | "paid" | "failed";

/** D9 payment steps. */
export type PaymentStep = "created" | "incoming_created" | "quoted" | "submitted" | "completed" | "failed";

export type AtRiskReason = "simulated_revocation" | "grant_revoked" | "rotation_failed";

/** A promise without any grant secret. approvalToken is server-side only. */
export type PromiseRecord = {
  id: string;
  freelancerWallet: string;
  freelancerName: string;
  payerWallet: string | null;
  assetCode: string;
  assetScale: number;
  totalValue: string;
  dueAt: string;
  description: string | null;
  invoiceRef: string | null;
  status: PromiseStatus;
  atRiskReason: AtRiskReason | null;
  approvalToken: string;
  createdAt: string;
};

export type AllocationRecord = {
  id: string;
  promiseId: string;
  label: string;
  recipientWallet: string;
  value: string;
  status: AllocationStatus;
  statusToken: string;
  simulated: boolean;
};

export type PaymentRecord = {
  id: string;
  allocationId: string;
  idempotencyKey: string;
  attempt: number;
  step: PaymentStep;
  incomingPaymentUrl: string | null;
  quoteUrl: string | null;
  outgoingPaymentUrl: string | null;
  debitValue: string | null; // payer asset (promise asset)
  receiveValue: string | null; // recipient asset, from the quote
  receiveAssetCode: string | null;
  receiveAssetScale: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type EventRecord = {
  id: number;
  promiseId: string;
  type: string;
  payload: unknown;
  at: string;
};

export type PendingGrantSecrets = {
  continueUri: string;
  continueToken: string;
  clientNonce: string;
  finishNonce: string;
};

export type ActiveGrantSecrets = {
  accessToken: string;
  manageUri: string;
};

// ---------- promises ----------

const PROMISE_COLUMNS = `
  id, freelancer_wallet AS freelancerWallet, freelancer_name AS freelancerName,
  payer_wallet AS payerWallet, asset_code AS assetCode, asset_scale AS assetScale,
  total_value AS totalValue, due_at AS dueAt, description, invoice_ref AS invoiceRef,
  status, at_risk_reason AS atRiskReason, approval_token AS approvalToken, created_at AS createdAt`;

export function insertPromise(p: PromiseRecord, freelancerKeyHash: string): void {
  getDb()
    .prepare(
      `INSERT INTO promises (id, freelancer_wallet, freelancer_name, payer_wallet, asset_code, asset_scale,
        total_value, due_at, description, invoice_ref, status, at_risk_reason, approval_token, freelancer_key_hash,
        created_at)
       VALUES (@id, @freelancerWallet, @freelancerName, @payerWallet, @assetCode, @assetScale,
        @totalValue, @dueAt, @description, @invoiceRef, @status, @atRiskReason, @approvalToken, @freelancerKeyHash,
        @createdAt)`,
    )
    .run({ ...p, freelancerKeyHash });
}

/** sha256 hex of the freelancer key; never part of PromiseRecord. */
export function getFreelancerKeyHash(promiseId: string): string | undefined {
  const row = getDb().prepare(`SELECT freelancer_key_hash AS h FROM promises WHERE id = ?`).get(promiseId) as
    | { h: string }
    | undefined;
  return row?.h;
}

export function setAtRiskReason(promiseId: string, reason: AtRiskReason | null): void {
  getDb().prepare(`UPDATE promises SET at_risk_reason = ? WHERE id = ?`).run(reason, promiseId);
}

export function getPromiseById(id: string): PromiseRecord | undefined {
  return getDb().prepare(`SELECT ${PROMISE_COLUMNS} FROM promises WHERE id = ?`).get(id) as
    | PromiseRecord
    | undefined;
}

export function getPromiseByApprovalToken(token: string): PromiseRecord | undefined {
  return getDb().prepare(`SELECT ${PROMISE_COLUMNS} FROM promises WHERE approval_token = ?`).get(token) as
    | PromiseRecord
    | undefined;
}

/** Stores the pending interactive grant (encrypted) and the payer wallet. */
export function savePendingGrant(promiseId: string, payerWallet: string, secrets: PendingGrantSecrets): void {
  getDb()
    .prepare(
      `UPDATE promises SET payer_wallet = ?, grant_continue_uri = ?, grant_continue_token = ?,
        grant_client_nonce = ?, grant_finish_nonce = ? WHERE id = ?`,
    )
    .run(
      payerWallet,
      encrypt(secrets.continueUri),
      encrypt(secrets.continueToken),
      encrypt(secrets.clientNonce),
      encrypt(secrets.finishNonce),
      promiseId,
    );
}

export function getPendingGrant(promiseId: string): PendingGrantSecrets | undefined {
  const row = getDb()
    .prepare(
      `SELECT grant_continue_uri AS continueUri, grant_continue_token AS continueToken,
        grant_client_nonce AS clientNonce, grant_finish_nonce AS finishNonce FROM promises WHERE id = ?`,
    )
    .get(promiseId) as Record<keyof PendingGrantSecrets, string | null> | undefined;
  if (!row?.continueUri || !row.continueToken || !row.clientNonce || !row.finishNonce) return undefined;
  return {
    continueUri: decrypt(row.continueUri),
    continueToken: decrypt(row.continueToken),
    clientNonce: decrypt(row.clientNonce),
    finishNonce: decrypt(row.finishNonce),
  };
}

/** Stores the access token (encrypted) and clears the one-shot continuation data. */
export function saveActiveGrant(promiseId: string, secrets: ActiveGrantSecrets): void {
  getDb()
    .prepare(
      `UPDATE promises SET grant_access_token = ?, grant_manage_uri = ?, grant_continue_uri = NULL,
        grant_continue_token = NULL, grant_client_nonce = NULL, grant_finish_nonce = NULL WHERE id = ?`,
    )
    .run(encrypt(secrets.accessToken), encrypt(secrets.manageUri), promiseId);
}

export function getActiveGrant(promiseId: string): ActiveGrantSecrets | undefined {
  const row = getDb()
    .prepare(`SELECT grant_access_token AS accessToken, grant_manage_uri AS manageUri FROM promises WHERE id = ?`)
    .get(promiseId) as Record<keyof ActiveGrantSecrets, string | null> | undefined;
  if (!row?.accessToken || !row.manageUri) return undefined;
  return { accessToken: decrypt(row.accessToken), manageUri: decrypt(row.manageUri) };
}

// ---------- allocations ----------

const ALLOCATION_COLUMNS = `
  id, promise_id AS promiseId, label, recipient_wallet AS recipientWallet, value, status,
  status_token AS statusToken, simulated`;

type AllocationRow = Omit<AllocationRecord, "simulated"> & { simulated: number };
const toAllocation = (row: AllocationRow): AllocationRecord => ({ ...row, simulated: row.simulated === 1 });

export function listAllocations(promiseId: string): AllocationRecord[] {
  const rows = getDb()
    .prepare(`SELECT ${ALLOCATION_COLUMNS} FROM allocations WHERE promise_id = ? ORDER BY rowid`)
    .all(promiseId) as AllocationRow[];
  return rows.map(toAllocation);
}

export function getAllocationByStatusToken(token: string): AllocationRecord | undefined {
  const row = getDb().prepare(`SELECT ${ALLOCATION_COLUMNS} FROM allocations WHERE status_token = ?`).get(token) as
    | AllocationRow
    | undefined;
  return row && toAllocation(row);
}

/** Deletes the promise's allocations and inserts the new set (call inside a transaction). */
export function replaceAllocationRows(promiseId: string, rows: AllocationRecord[]): void {
  const db = getDb();
  db.prepare(`DELETE FROM allocations WHERE promise_id = ?`).run(promiseId);
  const insert = db.prepare(
    `INSERT INTO allocations (id, promise_id, label, recipient_wallet, value, status, status_token, simulated)
     VALUES (@id, @promiseId, @label, @recipientWallet, @value, @status, @statusToken, @simulated)`,
  );
  for (const row of rows) insert.run({ ...row, simulated: row.simulated ? 1 : 0 });
}

// ---------- status updates (used only by lib/domain/stateMachine) ----------

// Payments: `step` is the D9 state; `status` mirrors it.
const STATUS_SQL = {
  promise: {
    update: `UPDATE promises SET status = @to WHERE id = @id AND status = @from`,
    get: `SELECT status AS s FROM promises WHERE id = ?`,
  },
  allocation: {
    update: `UPDATE allocations SET status = @to WHERE id = @id AND status = @from`,
    get: `SELECT status AS s FROM allocations WHERE id = ?`,
  },
  payment: {
    update: `UPDATE payments SET step = @to, status = @to WHERE id = @id AND step = @from`,
    get: `SELECT step AS s FROM payments WHERE id = ?`,
  },
} as const;

export type StatusEntity = keyof typeof STATUS_SQL;

/** Compare-and-set on status. Returns true if exactly one row changed. */
export function compareAndSetStatus(entity: StatusEntity, id: string, from: string, to: string): boolean {
  return getDb().prepare(STATUS_SQL[entity].update).run({ to, id, from }).changes === 1;
}

export function getStatus(entity: StatusEntity, id: string): string | undefined {
  const row = getDb().prepare(STATUS_SQL[entity].get).get(id) as { s: string } | undefined;
  return row?.s;
}

/** Promise that owns an allocation or payment (events are keyed by promise). */
export function getOwningPromiseId(entity: StatusEntity, id: string): string | undefined {
  if (entity === "promise") return id;
  const sql =
    entity === "allocation"
      ? `SELECT promise_id AS p FROM allocations WHERE id = ?`
      : `SELECT a.promise_id AS p FROM payments pm JOIN allocations a ON a.id = pm.allocation_id WHERE pm.id = ?`;
  const row = getDb().prepare(sql).get(id) as { p: string } | undefined;
  return row?.p;
}

// ---------- payments ----------

const paymentColumns = (alias: string) => `
  ${alias}.id, ${alias}.allocation_id AS allocationId, ${alias}.idempotency_key AS idempotencyKey,
  ${alias}.attempt, ${alias}.step, ${alias}.incoming_payment_url AS incomingPaymentUrl,
  ${alias}.quote_id AS quoteUrl, ${alias}.outgoing_payment_url AS outgoingPaymentUrl,
  ${alias}.debit_value AS debitValue, ${alias}.receive_value AS receiveValue,
  ${alias}.receive_asset_code AS receiveAssetCode, ${alias}.receive_asset_scale AS receiveAssetScale,
  ${alias}.error, ${alias}.created_at AS createdAt, ${alias}.completed_at AS completedAt`;

export function insertPayment(p: PaymentRecord): void {
  getDb()
    .prepare(
      `INSERT INTO payments (id, allocation_id, idempotency_key, attempt, step, status, incoming_payment_url, quote_id,
        outgoing_payment_url, debit_value, receive_value, receive_asset_code, receive_asset_scale, error, created_at,
        completed_at)
       VALUES (@id, @allocationId, @idempotencyKey, @attempt, @step, @step, @incomingPaymentUrl, @quoteUrl,
        @outgoingPaymentUrl, @debitValue, @receiveValue, @receiveAssetCode, @receiveAssetScale, @error, @createdAt,
        @completedAt)`,
    )
    .run(p);
}

export function getPayment(id: string): PaymentRecord | undefined {
  return getDb().prepare(`SELECT ${paymentColumns("pm")} FROM payments pm WHERE pm.id = ?`).get(id) as
    | PaymentRecord
    | undefined;
}

/** The highest attempt for an allocation. */
export function getLatestPayment(allocationId: string): PaymentRecord | undefined {
  return getDb()
    .prepare(`SELECT ${paymentColumns("pm")} FROM payments pm WHERE pm.allocation_id = ? ORDER BY pm.attempt DESC LIMIT 1`)
    .get(allocationId) as PaymentRecord | undefined;
}

export function listPaymentsForPromise(promiseId: string): PaymentRecord[] {
  return getDb()
    .prepare(
      `SELECT ${paymentColumns("pm")} FROM payments pm JOIN allocations a ON a.id = pm.allocation_id
       WHERE a.promise_id = ? ORDER BY pm.created_at, pm.attempt`,
    )
    .all(promiseId) as PaymentRecord[];
}

export type PaymentDataFields = Pick<
  PaymentRecord,
  | "incomingPaymentUrl"
  | "quoteUrl"
  | "outgoingPaymentUrl"
  | "debitValue"
  | "receiveValue"
  | "receiveAssetCode"
  | "receiveAssetScale"
  | "error"
  | "completedAt"
>;

const PAYMENT_FIELD_COLUMNS: Record<keyof PaymentDataFields, string> = {
  incomingPaymentUrl: "incoming_payment_url",
  quoteUrl: "quote_id",
  outgoingPaymentUrl: "outgoing_payment_url",
  debitValue: "debit_value",
  receiveValue: "receive_value",
  receiveAssetCode: "receive_asset_code",
  receiveAssetScale: "receive_asset_scale",
  error: "error",
  completedAt: "completed_at",
};

/** Persists data gathered by a pipeline step (the step itself changes only through transition()). */
export function updatePaymentData(id: string, fields: Partial<PaymentDataFields>): void {
  const keys = (Object.keys(fields) as (keyof PaymentDataFields)[]).filter((k) => k in PAYMENT_FIELD_COLUMNS);
  if (keys.length === 0) return;
  const assignments = keys.map((k) => `${PAYMENT_FIELD_COLUMNS[k]} = @${k}`).join(", ");
  const params: Record<string, unknown> = { id };
  for (const k of keys) params[k] = fields[k] ?? null;
  getDb().prepare(`UPDATE payments SET ${assignments} WHERE id = @id`).run(params);
}

// ---------- events ----------

export function insertEvent(promiseId: string, type: string, payload?: Record<string, unknown>, at = new Date()): void {
  getDb()
    .prepare(`INSERT INTO events (promise_id, type, payload, at) VALUES (?, ?, ?, ?)`)
    .run(promiseId, type, payload === undefined ? null : JSON.stringify(payload), at.toISOString());
}

export function listEvents(promiseId: string): EventRecord[] {
  const rows = getDb()
    .prepare(`SELECT id, promise_id AS promiseId, type, payload, at FROM events WHERE promise_id = ? ORDER BY id`)
    .all(promiseId) as (Omit<EventRecord, "payload"> & { payload: string | null })[];
  return rows.map((r) => ({ ...r, payload: r.payload === null ? null : (JSON.parse(r.payload) as unknown) }));
}

/** Time of the most recent event (stale-lock detection). */
export function getLatestEventAt(promiseId: string): string | undefined {
  const row = getDb().prepare(`SELECT MAX(at) AS at FROM events WHERE promise_id = ?`).get(promiseId) as
    | { at: string | null }
    | undefined;
  return row?.at ?? undefined;
}
