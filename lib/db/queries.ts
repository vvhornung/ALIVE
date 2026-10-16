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
  status, approval_token AS approvalToken, created_at AS createdAt`;

export function insertPromise(p: PromiseRecord): void {
  getDb()
    .prepare(
      `INSERT INTO promises (id, freelancer_wallet, freelancer_name, payer_wallet, asset_code, asset_scale,
        total_value, due_at, description, invoice_ref, status, approval_token, created_at)
       VALUES (@id, @freelancerWallet, @freelancerName, @payerWallet, @assetCode, @assetScale,
        @totalValue, @dueAt, @description, @invoiceRef, @status, @approvalToken, @createdAt)`,
    )
    .run(p);
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

export function getAllocationPromiseId(allocationId: string): string | undefined {
  const row = getDb().prepare(`SELECT promise_id AS promiseId FROM allocations WHERE id = ?`).get(allocationId) as
    | { promiseId: string }
    | undefined;
  return row?.promiseId;
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

const STATUS_TABLES = { promise: "promises", allocation: "allocations" } as const;

/** Compare-and-set on status. Returns true if exactly one row changed. */
export function compareAndSetStatus(
  entity: keyof typeof STATUS_TABLES,
  id: string,
  from: string,
  to: string,
): boolean {
  const table = STATUS_TABLES[entity];
  return getDb().prepare(`UPDATE ${table} SET status = ? WHERE id = ? AND status = ?`).run(to, id, from).changes === 1;
}

export function getStatus(entity: keyof typeof STATUS_TABLES, id: string): string | undefined {
  const table = STATUS_TABLES[entity];
  const row = getDb().prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id) as { status: string } | undefined;
  return row?.status;
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
