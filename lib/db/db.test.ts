import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "./connection";
import {
  compareAndSetStatus,
  getLatestPayment,
  insertPayment,
  listPaymentsForPromise,
  replaceAllocationRows,
  updatePaymentData,
  getStatus,
  getActiveGrant,
  getPendingGrant,
  getPromiseById,
  insertEvent,
  insertPromise,
  listEvents,
  saveActiveGrant,
  savePendingGrant,
  type PromiseRecord,
} from "./queries";
import Database from "better-sqlite3";
import { migrate, SchemaVersionError } from "./migrate";
import { SCHEMA_VERSION } from "./schema";

const promise: PromiseRecord = {
  id: "p1",
  freelancerWallet: "https://ilp.interledger-test.dev/freelancer",
  freelancerName: "Ana",
  payerWallet: null,
  assetCode: "USD",
  assetScale: 2,
  totalValue: "30000",
  dueAt: "2026-10-17",
  description: "Logo",
  invoiceRef: null,
  status: "draft",
  atRiskReason: null,
  approvalToken: "approval-token",
  createdAt: "2026-10-16T12:00:00.000Z",
};

beforeEach(() => resetDbForTests());

describe("db", () => {
  it("migrates idempotently", () => {
    expect(() => migrate(getDb())).not.toThrow();
  });

  it("round-trips a promise without secret fields", () => {
    insertPromise(promise, "key-hash");
    const row = getPromiseById("p1");
    expect(row).toEqual(promise);
    expect(Object.keys(row ?? {})).not.toContain("grantAccessToken");
  });

  it("enforces the status CHECK and FK constraints", () => {
    expect(() => insertPromise({ ...promise, status: "bogus" as PromiseRecord["status"] }, "key-hash")).toThrow();
    expect(() =>
      getDb()
        .prepare(
          `INSERT INTO allocations (id, promise_id, label, recipient_wallet, value, status, status_token)
           VALUES ('a', 'missing', 'x', 'w', '1', 'pending', 't')`,
        )
        .run(),
    ).toThrow();
  });

  it("stores grant secrets encrypted and decrypts them on read", () => {
    insertPromise(promise, "key-hash");
    savePendingGrant("p1", "https://ilp.interledger-test.dev/payer", {
      continueUri: "https://auth/continue/1",
      continueToken: "continue-token-plain",
      clientNonce: "client-nonce-plain",
      finishNonce: "finish-nonce-plain",
    });
    const raw = getDb().prepare("SELECT * FROM promises WHERE id = 'p1'").get() as Record<string, unknown>;
    expect(JSON.stringify(raw)).not.toContain("continue-token-plain");
    expect(JSON.stringify(raw)).not.toContain("client-nonce-plain");
    expect(getPendingGrant("p1")?.continueToken).toBe("continue-token-plain");

    saveActiveGrant("p1", { accessToken: "access-token-plain", manageUri: "https://auth/token/1" });
    const raw2 = getDb().prepare("SELECT * FROM promises WHERE id = 'p1'").get() as Record<string, unknown>;
    expect(JSON.stringify(raw2)).not.toContain("access-token-plain");
    expect(getActiveGrant("p1")).toEqual({ accessToken: "access-token-plain", manageUri: "https://auth/token/1" });
    expect(getPendingGrant("p1")).toBeUndefined(); // continuation data cleared
  });

  it("compare-and-set only changes the expected status", () => {
    insertPromise(promise, "key-hash");
    expect(compareAndSetStatus("promise", "p1", "active", "executing")).toBe(false);
    expect(compareAndSetStatus("promise", "p1", "draft", "awaiting_approval")).toBe(true);
  });

  it("stores events with JSON payloads", () => {
    insertPromise(promise, "key-hash");
    insertEvent("p1", "promise_created", { totalValue: "30000" });
    expect(listEvents("p1")).toMatchObject([{ type: "promise_created", payload: { totalValue: "30000" } }]);
  });

  it("refuses a database created by another schema version", () => {
    const old = new Database(":memory:");
    old.exec("CREATE TABLE promises (id TEXT PRIMARY KEY)");
    expect(() => migrate(old)).toThrow(SchemaVersionError);
    const fresh = new Database(":memory:");
    migrate(fresh);
    expect(fresh.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
  });

  it("stores payments, updates step data and finds the latest attempt", () => {
    insertPromise(promise, "key-hash");
    replaceAllocationRows("p1", [
      { id: "a1", promiseId: "p1", label: "Rent", recipientWallet: "w", value: "100", status: "pending", statusToken: "t", simulated: false },
    ]);
    const base = {
      allocationId: "a1", step: "created" as const, incomingPaymentUrl: null, quoteUrl: null, outgoingPaymentUrl: null,
      debitValue: null, receiveValue: null, receiveAssetCode: null, receiveAssetScale: null, error: null,
      createdAt: "2026-10-16T12:00:00.000Z", completedAt: null,
    };
    insertPayment({ ...base, id: "pay1", idempotencyKey: "p1:a1:1", attempt: 1 });
    insertPayment({ ...base, id: "pay2", idempotencyKey: "p1:a1:2", attempt: 2 });
    expect(() => insertPayment({ ...base, id: "pay3", idempotencyKey: "p1:a1:2", attempt: 3 })).toThrow();
    updatePaymentData("pay2", { incomingPaymentUrl: "https://rs/incoming/1", debitValue: "100" });
    expect(compareAndSetStatus("payment", "pay2", "created", "incoming_created")).toBe(true);
    expect(getStatus("payment", "pay2")).toBe("incoming_created");
    expect(getLatestPayment("a1")).toMatchObject({ id: "pay2", attempt: 2, step: "incoming_created", debitValue: "100" });
    expect(listPaymentsForPromise("p1").map((p) => p.id)).toEqual(["pay1", "pay2"]);
  });
});
