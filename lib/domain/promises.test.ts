import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveGrant, getPendingGrant, getPromiseById, listEvents, resetDbForTests } from "@/lib/db";
import { continueGrant, requestOutgoingGrant, resolveWallet, verifyInteractHash } from "@/lib/op";
import { ACTIVE_GRANT, PENDING_GRANT, resolveByName, wallet } from "@/test/opMock";
import {
  completeAuthorization,
  createPromise,
  getPromiseByApprovalTokenOrThrow,
  rejectAuthorization,
  startAuthorization,
} from "./promises";

vi.mock("@/lib/op", async () => ({
  ...(await vi.importActual<typeof import("@/lib/op/errors")>("@/lib/op/errors")),
  resolveWallet: vi.fn(),
  requestOutgoingGrant: vi.fn(),
  continueGrant: vi.fn(),
  verifyInteractHash: vi.fn(),
}));

const NOW = new Date("2026-10-16T15:00:00Z");
const input = {
  freelancerWallet: "https://ilp.interledger-test.dev/ana",
  amount: "300",
  assetCode: "USD",
  dueAt: "2026-10-17",
  description: "Logo design",
};

beforeEach(() => {
  resetDbForTests();
  vi.mocked(resolveWallet).mockReset().mockImplementation(resolveByName());
  vi.mocked(requestOutgoingGrant).mockReset().mockResolvedValue(PENDING_GRANT);
  vi.mocked(continueGrant).mockReset().mockResolvedValue(ACTIVE_GRANT);
  vi.mocked(verifyInteractHash).mockReset().mockReturnValue(true);
});

describe("createPromise", () => {
  it("creates an awaiting_approval promise in minor units with a strong approval token", async () => {
    const { promise, approvalToken } = await createPromise(input, NOW);
    expect(promise).toMatchObject({ status: "awaiting_approval", totalValue: "30000", assetScale: 2, freelancerName: "Ana" });
    expect(Buffer.from(approvalToken, "base64url").length).toBeGreaterThanOrEqual(16);
    expect(getPromiseById(promise.id)?.status).toBe("awaiting_approval");
    expect(listEvents(promise.id).map((e) => e.type)).toEqual(["promise_created", "approval_requested"]);
  });

  it("falls back to the wallet host/path when there is no public name", async () => {
    const { promise } = await createPromise({ ...input, freelancerWallet: "https://ilp.interledger-test.dev/anon" }, NOW);
    expect(promise.freelancerName).toBe("ilp.interledger-test.dev/anon");
  });

  it("rejects bad amounts", async () => {
    await expect(createPromise({ ...input, amount: "0" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createPromise({ ...input, amount: "1.234" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createPromise({ ...input, amount: "-5" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts a promise due 'today' at 20:30 in Bogotá even though UTC is already tomorrow", async () => {
    const evening = new Date("2026-10-17T01:30:00Z"); // 2026-10-16 20:30 Bogotá
    await expect(createPromise({ ...input, dueAt: "2026-10-16" }, evening)).resolves.toBeDefined();
  });

  it("rejects a past due date (Bogotá calendar)", async () => {
    await expect(createPromise({ ...input, dueAt: "2026-10-15" }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("approval flow", () => {
  async function created() {
    return createPromise(input, NOW);
  }

  it("startAuthorization requests the D1 grant and stores the continuation encrypted", async () => {
    const { promise, approvalToken } = await created();
    const result = await startAuthorization(promise.id, approvalToken, "$ilp.interledger-test.dev/payer");
    expect(result).toEqual({ redirectUrl: PENDING_GRANT.redirectUrl });
    expect(vi.mocked(requestOutgoingGrant).mock.calls[0][0]).toMatchObject({
      debitAmount: { value: "30000", assetCode: "USD", assetScale: 2 },
      finishUri: `http://localhost:3000/api/grants/callback/${promise.id}`,
    });
    expect(getPendingGrant(promise.id)).toEqual({
      continueUri: PENDING_GRANT.continueUri,
      continueToken: PENDING_GRANT.continueToken,
      clientNonce: PENDING_GRANT.clientNonce,
      finishNonce: PENDING_GRANT.finishNonce,
    });
    expect(getPromiseById(promise.id)?.payerWallet).toBe("https://ilp.interledger-test.dev/payer");
  });

  it("rejects a wrong approval token", async () => {
    const { promise } = await created();
    await expect(startAuthorization(promise.id, "wrong", "https://ilp.interledger-test.dev/payer")).rejects.toMatchObject(
      { code: "INVALID_APPROVAL_TOKEN" },
    );
  });

  it("enforces D3: payer asset must match the promise", async () => {
    vi.mocked(resolveWallet).mockImplementation(resolveByName({ payer: wallet("payer", "EUR", 2) }));
    const { promise, approvalToken } = await created();
    await expect(
      startAuthorization(promise.id, approvalToken, "https://ilp.interledger-test.dev/payer"),
    ).rejects.toMatchObject({ code: "ASSET_MISMATCH", httpStatus: 422 });
    expect(requestOutgoingGrant).not.toHaveBeenCalled();
  });

  it("completeAuthorization stores the token encrypted and activates", async () => {
    const { promise, approvalToken } = await created();
    await startAuthorization(promise.id, approvalToken, "https://ilp.interledger-test.dev/payer");
    const done = await completeAuthorization(promise.id, "interact-ref", "hash");
    expect(done.status).toBe("active");
    expect(getActiveGrant(promise.id)).toEqual({ accessToken: ACTIVE_GRANT.accessToken, manageUri: ACTIVE_GRANT.manageUri });
    expect(getPendingGrant(promise.id)).toBeUndefined();
    expect(vi.mocked(verifyInteractHash).mock.calls[0][0]).toMatchObject({
      clientNonce: PENDING_GRANT.clientNonce,
      finishNonce: PENDING_GRANT.finishNonce,
      interactRef: "interact-ref",
    });
    expect(listEvents(promise.id).map((e) => e.type)).toContain("payer_approved");
  });

  it("is idempotent once active (repeated callback does not call the AS again)", async () => {
    const { promise, approvalToken } = await created();
    await startAuthorization(promise.id, approvalToken, "https://ilp.interledger-test.dev/payer");
    await completeAuthorization(promise.id, "ref", "hash");
    await completeAuthorization(promise.id, "ref", "hash");
    expect(continueGrant).toHaveBeenCalledTimes(1);
  });

  it("continues with a warning on hash mismatch when STRICT_HASH=false", async () => {
    vi.mocked(verifyInteractHash).mockReturnValue(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { promise, approvalToken } = await created();
    await startAuthorization(promise.id, approvalToken, "https://ilp.interledger-test.dev/payer");
    await expect(completeAuthorization(promise.id, "ref", "bad")).resolves.toMatchObject({ status: "active" });
    expect(listEvents(promise.id).map((e) => e.type)).toContain("hash_mismatch");
  });

  it("rejectAuthorization keeps awaiting_approval and logs payer_rejected", async () => {
    const { promise, approvalToken } = await created();
    await startAuthorization(promise.id, approvalToken, "https://ilp.interledger-test.dev/payer");
    expect(rejectAuthorization(promise.id).status).toBe("awaiting_approval");
    expect(listEvents(promise.id).map((e) => e.type)).toContain("payer_rejected");
  });

  it("looks up the payer page by approval token only", async () => {
    const { promise, approvalToken } = await created();
    expect(getPromiseByApprovalTokenOrThrow(approvalToken).id).toBe(promise.id);
    expect(() => getPromiseByApprovalTokenOrThrow(promise.id)).toThrow(expect.objectContaining({ code: "INVALID_APPROVAL_TOKEN" }));
  });

  it("never writes secrets into events", async () => {
    const { promise, approvalToken } = await created();
    await startAuthorization(promise.id, approvalToken, "https://ilp.interledger-test.dev/payer");
    await completeAuthorization(promise.id, "ref", "hash");
    const events = JSON.stringify(listEvents(promise.id));
    expect(events).not.toContain("SECRET-");
    expect(events).not.toContain(approvalToken);
  });
});
