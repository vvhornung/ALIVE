import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "./connection";
import {
  compareAndSetStatus,
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
import { migrate } from "./migrate";

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
  approvalToken: "approval-token",
  createdAt: "2026-10-16T12:00:00.000Z",
};

beforeEach(() => resetDbForTests());

describe("db", () => {
  it("migrates idempotently", () => {
    expect(() => migrate(getDb())).not.toThrow();
  });

  it("round-trips a promise without secret fields", () => {
    insertPromise(promise);
    const row = getPromiseById("p1");
    expect(row).toEqual(promise);
    expect(Object.keys(row ?? {})).not.toContain("grantAccessToken");
  });

  it("enforces the status CHECK and FK constraints", () => {
    expect(() => insertPromise({ ...promise, status: "bogus" as PromiseRecord["status"] })).toThrow();
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
    insertPromise(promise);
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
    insertPromise(promise);
    expect(compareAndSetStatus("promise", "p1", "active", "executing")).toBe(false);
    expect(compareAndSetStatus("promise", "p1", "draft", "awaiting_approval")).toBe(true);
  });

  it("stores events with JSON payloads", () => {
    insertPromise(promise);
    insertEvent("p1", "promise_created", { totalValue: "30000" });
    expect(listEvents("p1")).toMatchObject([{ type: "promise_created", payload: { totalValue: "30000" } }]);
  });
});
