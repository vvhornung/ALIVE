import { describe, expect, it } from "vitest";
import type { AllocationRecord, EventRecord, PaymentRecord, PromiseRecord } from "@/lib/db";
import { RECORDS_DISCLAIMER, toApprovalView, toPromiseView, toPublicStatusView, toRecordsPack, toTimeline } from "./mappers";

// Records stuffed with secret-looking extras, as if a query ever selected too much.
const promise = {
  id: "p1",
  freelancerWallet: "https://ilp.interledger-test.dev/ana",
  freelancerName: "Ana",
  payerWallet: "https://ilp.interledger-test.dev/payer",
  assetCode: "USD",
  assetScale: 2,
  totalValue: "30000",
  dueAt: "2026-10-17",
  description: "Logo",
  invoiceRef: "INV-1",
  status: "active",
  atRiskReason: null,
  approvalToken: "APPROVAL-TOKEN-SECRET",
  createdAt: "2026-10-16T15:00:00.000Z",
  freelancerKeyHash: "SECRET-key-hash",
  grantAccessToken: "SECRET-access",
  grantManageUri: "SECRET-manage",
  grantContinueToken: "SECRET-continue",
  grantContinueUri: "SECRET-continue-uri",
  grantClientNonce: "SECRET-nonce",
  grantFinishNonce: "SECRET-finish",
} as PromiseRecord;

const allocation: AllocationRecord = {
  id: "a1",
  promiseId: "p1",
  label: "Rent",
  recipientWallet: "https://ilp.interledger-test.dev/landlord",
  value: "12000",
  status: "paid",
  statusToken: "STATUS-TOKEN-a1",
  simulated: false,
};

const OP_URL = "https://rs.interledger-test.dev/OPURL";
const payment = (attempt: number, step: PaymentRecord["step"]): PaymentRecord => ({
  id: `pay${attempt}`,
  allocationId: "a1",
  idempotencyKey: `p1:a1:${attempt}`,
  attempt,
  step,
  incomingPaymentUrl: `${OP_URL}/incoming/${attempt}`,
  quoteUrl: `${OP_URL}/quotes/${attempt}`,
  outgoingPaymentUrl: `${OP_URL}/outgoing/${attempt}`,
  debitValue: "12000",
  receiveValue: "11900",
  receiveAssetCode: "USD",
  receiveAssetScale: 2,
  error: step === "failed" ? "[outgoing.create] Bad request | status=400" : null,
  createdAt: `2026-10-17T10:0${attempt}:00.000Z`,
  completedAt: step === "completed" ? "2026-10-17T10:05:00.000Z" : null,
});
const payments = [payment(1, "failed"), payment(2, "completed")];

const events: EventRecord[] = [
  { id: 1, promiseId: "p1", type: "promise_created", payload: { totalValue: "30000" }, at: "2026-10-16T15:00:00.000Z" },
  { id: 2, promiseId: "p1", type: "payment_quoted", payload: { paymentId: "pay2", debit: "120.00 USD", receive: "119.00 USD" }, at: "2026-10-17T10:02:00.000Z" },
  { id: 3, promiseId: "p1", type: "payment_failed", payload: { paymentId: "pay1", error: `secret-ish detail ${OP_URL}` }, at: "2026-10-17T10:01:00.000Z" },
  { id: 4, promiseId: "p1", type: "payment_completed", payload: { paymentId: "pay2", received: "119.00 USD" }, at: "2026-10-17T10:05:00.000Z" },
];

const FORBIDDEN_KEYS = [
  "approvalToken",
  "statusToken",
  "freelancerKeyHash",
  "grantAccessToken",
  "grantManageUri",
  "grantContinueToken",
  "grantContinueUri",
  "grantClientNonce",
  "grantFinishNonce",
  "accessToken",
  "manageUri",
  "continueUri",
  "continueToken",
  "nonce",
  "payload",
];

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [k, ...allKeys(v)]);
  }
  return [];
}

function assertNoSecrets(view: unknown) {
  const json = JSON.stringify(view);
  expect(json).not.toContain("SECRET");
  for (const key of allKeys(view)) expect(FORBIDDEN_KEYS).not.toContain(key);
}

describe("DTO mappers", () => {
  it("PromiseView: no secrets, no Open Payments URLs, latest payment per allocation", () => {
    const view = toPromiseView(promise, [allocation], payments, "http://localhost:3000");
    assertNoSecrets(view);
    expect(JSON.stringify(view)).not.toContain(OP_URL);
    expect(view.amount.display).toBe("300.00 USD");
    expect(view.unallocated.display).toBe("180.00 USD");
    expect(view.allocations[0].statusUrl).toBe("http://localhost:3000/status/STATUS-TOKEN-a1");
    expect(view.allocations[0].payment).toMatchObject({
      attempt: 2,
      step: "completed",
      debit: { display: "120.00 USD" },
      receive: { display: "119.00 USD" },
      completedAt: "2026-10-17T10:05:00.000Z",
    });
    expect(view.atRisk).toBeNull();
  });

  it("PromiseView marks a simulated revocation", () => {
    const view = toPromiseView(
      { ...promise, status: "at_risk", atRiskReason: "simulated_revocation" },
      [allocation],
      [],
      "http://x",
    );
    expect(view.atRisk).toEqual({ reason: "simulated_revocation", simulated: true });
  });

  it("ApprovalView: no secrets, no allocation details; flags re-approval", () => {
    const view = toApprovalView(promise);
    assertNoSecrets(view);
    expect(JSON.stringify(view)).not.toContain("STATUS-TOKEN");
    expect(view.reapprovalNeeded).toBe(false);
    expect(toApprovalView({ ...promise, status: "at_risk", atRiskReason: "grant_revoked" }).reapprovalNeeded).toBe(true);
  });

  it("PublicStatusView: only the one allocation, no URLs, no error text", () => {
    const view = toPublicStatusView(promise, allocation, payment(1, "failed"));
    assertNoSecrets(view);
    const json = JSON.stringify(view);
    expect(json).not.toContain(OP_URL);
    expect(json).not.toContain("Bad request");
    expect(json).not.toContain("payer");
    expect(Object.keys(view).sort()).toEqual(
      ["amount", "dueAt", "freelancerName", "label", "note", "payment", "simulated", "status", "testMode"].sort(),
    );
  });

  it("timeline: human summaries, never raw payloads or URLs", () => {
    const timeline = toTimeline(promise, events, [allocation], payments);
    assertNoSecrets(timeline);
    expect(JSON.stringify(timeline)).not.toContain(OP_URL);
    expect(timeline.map((e) => e.summary)).toEqual([
      "Promise created for 300.00 USD",
      "Quote for Rent: payer pays 120.00 USD, recipient gets 119.00 USD",
      "Payment to Rent failed",
      "Rent received 119.00 USD",
    ]);
  });

  it("records pack: Open Payments URLs included as evidence, still no secrets", () => {
    const pack = toRecordsPack(promise, [allocation], payments, events, new Date("2026-10-17T12:00:00Z"));
    assertNoSecrets(pack);
    expect(pack).toMatchObject({ kind: "alive.records-pack", testMode: true, disclaimer: RECORDS_DISCLAIMER });
    expect(pack.payments.map((p) => p.outgoingPaymentUrl)).toEqual([`${OP_URL}/outgoing/1`, `${OP_URL}/outgoing/2`]);
    expect(JSON.stringify(pack)).not.toContain("quotes/"); // only incoming/outgoing URLs
    expect(JSON.stringify(pack.events)).not.toContain(OP_URL);
  });
});
