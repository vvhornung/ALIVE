import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPromiseById, inTransaction, listEvents, resetDbForTests, setAtRiskReason } from "@/lib/db";
import { continueGrant, requestOutgoingGrant, resolveWallet, verifyInteractHash } from "@/lib/op";
import { ACTIVE_GRANT, PENDING_GRANT, resolveByName } from "@/test/opMock";
import { assertFreelancerKey } from "./access";
import { completeAuthorization, createPromise, rejectAuthorization, startAuthorization } from "./promises";
import { setSimulatedRevocation } from "./revocation";
import { transition } from "./stateMachine";

vi.mock("@/lib/op", async () => ({
  ...(await vi.importActual<typeof import("@/lib/op/errors")>("@/lib/op/errors")),
  resolveWallet: vi.fn(),
  requestOutgoingGrant: vi.fn(),
  continueGrant: vi.fn(),
  verifyInteractHash: vi.fn(),
}));

const NOW = new Date("2026-10-16T15:00:00Z");
const PAYER = "https://ilp.interledger-test.dev/payer";

async function approved() {
  const created = await createPromise(
    { freelancerWallet: "https://ilp.interledger-test.dev/ana", amount: "3.00", assetCode: "USD", dueAt: "2026-10-17" },
    NOW,
  );
  await startAuthorization(created.promise.id, created.approvalToken, PAYER);
  await completeAuthorization(created.promise.id, "ref", "hash");
  return created;
}

function realAtRisk(promiseId: string, reason: "grant_revoked" | "rotation_failed") {
  inTransaction(() => {
    transition("promise", promiseId, "active", "executing", { type: "test" });
    transition("promise", promiseId, "executing", "at_risk", { type: reason });
    setAtRiskReason(promiseId, reason);
  });
}

beforeEach(() => {
  resetDbForTests();
  vi.mocked(resolveWallet).mockReset().mockImplementation(resolveByName());
  vi.mocked(requestOutgoingGrant).mockReset().mockResolvedValue(PENDING_GRANT);
  vi.mocked(continueGrant).mockReset().mockResolvedValue(ACTIVE_GRANT);
  vi.mocked(verifyInteractHash).mockReset().mockReturnValue(true);
});

describe("revoke-sim", () => {
  it("active → at_risk (simulated) → active, labeled simulated in events", async () => {
    const { promise } = await approved();
    expect(setSimulatedRevocation(promise.id, true)).toMatchObject({
      status: "at_risk",
      atRiskReason: "simulated_revocation",
    });
    expect(setSimulatedRevocation(promise.id, true).status).toBe("at_risk"); // idempotent
    expect(setSimulatedRevocation(promise.id, false)).toMatchObject({ status: "active", atRiskReason: null });
    const events = listEvents(promise.id).filter((e) => e.type.startsWith("revocation_"));
    expect(events.map((e) => e.type)).toEqual(["revocation_simulated", "revocation_cleared"]);
    expect(events.every((e) => (e.payload as { simulated?: boolean }).simulated === true)).toBe(true);
  });

  it("cannot clear a REAL revocation", async () => {
    const { promise } = await approved();
    realAtRisk(promise.id, "grant_revoked");
    expect(() => setSimulatedRevocation(promise.id, false)).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
  });

  it("only an active promise can be put at risk", async () => {
    const { promise } = await createPromise(
      { freelancerWallet: "https://ilp.interledger-test.dev/ana", amount: "1", assetCode: "USD", dueAt: "2026-10-17" },
      NOW,
    );
    expect(() => setSimulatedRevocation(promise.id, true)).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
  });
});

describe("re-approval from at_risk", () => {
  it.each(["grant_revoked", "rotation_failed"] as const)("works after %s, for the unpaid amount only", async (reason) => {
    const { promise, approvalToken } = await approved();
    realAtRisk(promise.id, reason);
    vi.mocked(requestOutgoingGrant).mockClear();

    await startAuthorization(promise.id, approvalToken, PAYER);
    expect(vi.mocked(requestOutgoingGrant).mock.calls[0][0].debitAmount.value).toBe("300");
    await completeAuthorization(promise.id, "ref-2", "hash");

    expect(getPromiseById(promise.id)).toMatchObject({ status: "active", atRiskReason: null });
    const types = listEvents(promise.id).map((e) => e.type);
    expect(types).toContain("reapproval_started");
    expect(types).toContain("reapproved");
  });

  it("is not allowed for a simulated revocation (use revoke-sim)", async () => {
    const { promise, approvalToken } = await approved();
    setSimulatedRevocation(promise.id, true);
    await expect(startAuthorization(promise.id, approvalToken, PAYER)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("must come from the same payer wallet", async () => {
    const { promise, approvalToken } = await approved();
    realAtRisk(promise.id, "grant_revoked");
    await expect(
      startAuthorization(promise.id, approvalToken, "https://ilp.interledger-test.dev/someone-else"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("a declined re-approval keeps at_risk and logs payer_rejected", async () => {
    const { promise, approvalToken } = await approved();
    realAtRisk(promise.id, "grant_revoked");
    await startAuthorization(promise.id, approvalToken, PAYER);
    expect(rejectAuthorization(promise.id).status).toBe("at_risk");
    expect(listEvents(promise.id).map((e) => e.type)).toContain("payer_rejected");
  });
});

describe("freelancer key", () => {
  it("accepts the key returned at creation and rejects anything else as NOT_FOUND", async () => {
    const { promise, freelancerKey } = await approved();
    expect(assertFreelancerKey(promise.id, freelancerKey).id).toBe(promise.id);
    for (const key of [null, undefined, "", "wrong", freelancerKey.slice(1)]) {
      expect(() => assertFreelancerKey(promise.id, key)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    }
    expect(() => assertFreelancerKey("unknown-id", freelancerKey)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });
});
