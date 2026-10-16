import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAllocations, listEvents, resetDbForTests } from "@/lib/db";
import { requestOutgoingGrant, resolveWallet } from "@/lib/op";
import { PENDING_GRANT, resolveByName } from "@/test/opMock";
import { replaceAllocations } from "./allocations";
import { createPromise } from "./promises";
import { transition } from "./stateMachine";

vi.mock("@/lib/op", async () => ({
  ...(await vi.importActual<typeof import("@/lib/op/errors")>("@/lib/op/errors")),
  resolveWallet: vi.fn(),
  requestOutgoingGrant: vi.fn(),
  continueGrant: vi.fn(),
  verifyInteractHash: vi.fn(),
}));

const NOW = new Date("2026-10-16T15:00:00Z");

async function promiseOf(amount: string) {
  const { promise } = await createPromise(
    { freelancerWallet: "https://ilp.interledger-test.dev/ana", amount, assetCode: "USD", dueAt: "2026-10-17" },
    NOW,
  );
  return promise;
}

const item = (label: string, amount: string, simulated = false) => ({
  label,
  recipientWallet: `https://ilp.interledger-test.dev/${label.toLowerCase()}`,
  amount,
  simulated,
});

beforeEach(() => {
  resetDbForTests();
  vi.mocked(resolveWallet).mockReset().mockImplementation(resolveByName());
  vi.mocked(requestOutgoingGrant).mockReset().mockResolvedValue(PENDING_GRANT);
});

describe("replaceAllocations", () => {
  it("accepts allocations that add up exactly to the total", async () => {
    const promise = await promiseOf("3.00");
    const rows = await replaceAllocations(promise.id, [item("Me", "1.00"), item("Rent", "1.50"), item("PILA", "0.50", true)]);
    expect(rows.map((r) => r.value)).toEqual(["100", "150", "50"]);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
    expect(rows.find((r) => r.label === "PILA")?.simulated).toBe(true);
    expect(new Set(rows.map((r) => r.statusToken)).size).toBe(3);
    for (const r of rows) expect(Buffer.from(r.statusToken, "base64url").length).toBeGreaterThanOrEqual(16);
  });

  it("rejects a sum 1 minor unit over the total, before resolving any wallet", async () => {
    const promise = await promiseOf("3.00");
    vi.mocked(resolveWallet).mockClear();
    await expect(replaceAllocations(promise.id, [item("Me", "1.50"), item("Rent", "1.51")])).rejects.toMatchObject({
      code: "ALLOCATION_EXCEEDS_TOTAL",
      httpStatus: 422,
    });
    expect(resolveWallet).not.toHaveBeenCalled();
    expect(listAllocations(promise.id)).toHaveLength(0);
  });

  it("replaces the previous set", async () => {
    const promise = await promiseOf("3.00");
    await replaceAllocations(promise.id, [item("Me", "1.00"), item("Rent", "1.00")]);
    await replaceAllocations(promise.id, [item("Designer", "2.00")]);
    expect(listAllocations(promise.id).map((r) => r.label)).toEqual(["Designer"]);
    expect(listEvents(promise.id).filter((e) => e.type === "allocations_replaced")).toHaveLength(2);
  });

  it("allows an empty list (clears allocations)", async () => {
    const promise = await promiseOf("3.00");
    await replaceAllocations(promise.id, [item("Me", "1.00")]);
    await expect(replaceAllocations(promise.id, [])).resolves.toEqual([]);
  });

  it("rejects amounts with more decimals than the asset scale, zero, or blank labels", async () => {
    const promise = await promiseOf("3.00");
    await expect(replaceAllocations(promise.id, [item("Me", "1.005")])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(replaceAllocations(promise.id, [item("Me", "0")])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(replaceAllocations(promise.id, [{ ...item("Me", "1"), label: "  " }])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("is not allowed once the promise is executing", async () => {
    const promise = await promiseOf("3.00");
    transition("promise", promise.id, "awaiting_approval", "active", { type: "test" });
    transition("promise", promise.id, "active", "executing", { type: "test" });
    await expect(replaceAllocations(promise.id, [item("Me", "1.00")])).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("returns NOT_FOUND for an unknown promise", async () => {
    await expect(replaceAllocations("nope", [])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
