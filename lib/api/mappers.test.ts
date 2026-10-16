import { describe, expect, it } from "vitest";
import type { AllocationRecord, PromiseRecord } from "@/lib/db";
import { toApprovalView, toPromiseView, toPublicStatusView } from "./mappers";

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
  status: "pending",
  statusToken: "STATUS-TOKEN-a1",
  simulated: false,
};

const FORBIDDEN_KEYS = [
  "approvalToken",
  "statusToken",
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
  it("PromiseView has no secrets and computes allocated/unallocated with BigInt", () => {
    const view = toPromiseView(promise, [allocation], "http://localhost:3000");
    assertNoSecrets(view);
    expect(view.amount.display).toBe("300.00 USD");
    expect(view.allocated.value).toBe("12000");
    expect(view.unallocated.display).toBe("180.00 USD");
    // The freelancer gets each recipient's public status link (by design), not the token field.
    expect(view.allocations[0].statusUrl).toBe("http://localhost:3000/status/STATUS-TOKEN-a1");
  });

  it("ApprovalView has no secrets and no allocation details", () => {
    const view = toApprovalView(promise);
    assertNoSecrets(view);
    expect(JSON.stringify(view)).not.toContain("STATUS-TOKEN");
    expect(view).toMatchObject({ freelancerName: "Ana", testMode: true });
  });

  it("PublicStatusView exposes only the one allocation", () => {
    const view = toPublicStatusView(promise, allocation);
    assertNoSecrets(view);
    expect(Object.keys(view).sort()).toEqual(
      ["amount", "dueAt", "freelancerName", "label", "note", "simulated", "status", "testMode"].sort(),
    );
    expect(JSON.stringify(view)).not.toContain("payer");
  });
});
