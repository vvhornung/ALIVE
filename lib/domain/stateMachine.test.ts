import { beforeEach, describe, expect, it } from "vitest";
import {
  insertPromise,
  listEvents,
  replaceAllocationRows,
  resetDbForTests,
  getPromiseById,
  listAllocations,
  type AllocationStatus,
  type PromiseStatus,
} from "@/lib/db";
import { DomainError } from "./errors";
import { ALLOCATION_TRANSITIONS, canTransition, PROMISE_TRANSITIONS, transition } from "./stateMachine";

const PROMISE_STATUSES = Object.keys(PROMISE_TRANSITIONS) as PromiseStatus[];
const ALLOCATION_STATUSES = Object.keys(ALLOCATION_TRANSITIONS) as AllocationStatus[];

const LEGAL_PROMISE: [PromiseStatus, PromiseStatus][] = [
  ["draft", "awaiting_approval"],
  ["awaiting_approval", "active"],
  ["awaiting_approval", "expired"],
  ["active", "executing"],
  ["active", "at_risk"],
  ["active", "expired"],
  ["executing", "completed"],
  ["executing", "partially_failed"],
  ["executing", "at_risk"],
];
const LEGAL_ALLOCATION: [AllocationStatus, AllocationStatus][] = [
  ["pending", "paying"],
  ["paying", "paid"],
  ["paying", "failed"],
];

function seedPromise(status: PromiseStatus) {
  insertPromise({
    id: "p1",
    freelancerWallet: "https://ilp.interledger-test.dev/f",
    freelancerName: "Ana",
    payerWallet: null,
    assetCode: "USD",
    assetScale: 2,
    totalValue: "1000",
    dueAt: "2026-10-17",
    description: null,
    invoiceRef: null,
    status,
    atRiskReason: null,
    approvalToken: "tok",
    createdAt: new Date().toISOString(),
  }, "key-hash");
}

beforeEach(() => resetDbForTests());

describe("transition tables", () => {
  it("promise: exactly the AGENTS §9 moves are legal", () => {
    for (const from of PROMISE_STATUSES) {
      for (const to of PROMISE_STATUSES) {
        const legal = LEGAL_PROMISE.some(([f, t]) => f === from && t === to);
        expect(canTransition("promise", from, to), `${from} → ${to}`).toBe(legal);
      }
    }
  });

  it("allocation: exactly the AGENTS §9 moves are legal", () => {
    for (const from of ALLOCATION_STATUSES) {
      for (const to of ALLOCATION_STATUSES) {
        const legal = LEGAL_ALLOCATION.some(([f, t]) => f === from && t === to);
        expect(canTransition("allocation", from, to), `${from} → ${to}`).toBe(legal);
      }
    }
  });
});

describe("transition()", () => {
  it("updates status and appends an event", () => {
    seedPromise("draft");
    transition("promise", "p1", "draft", "awaiting_approval", { type: "approval_requested" });
    expect(getPromiseById("p1")?.status).toBe("awaiting_approval");
    expect(listEvents("p1")).toMatchObject([
      { type: "approval_requested", payload: { from: "draft", to: "awaiting_approval" } },
    ]);
  });

  it("rejects illegal moves without touching the DB", () => {
    seedPromise("draft");
    expect(() => transition("promise", "p1", "draft", "active", { type: "x" })).toThrow(DomainError);
    expect(getPromiseById("p1")?.status).toBe("draft");
    expect(listEvents("p1")).toHaveLength(0);
  });

  it("rejects a stale `from` (compare-and-set) and writes no event", () => {
    seedPromise("active");
    try {
      transition("promise", "p1", "draft", "awaiting_approval", { type: "x" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toMatchObject({ code: "INVALID_STATE" });
    }
    expect(listEvents("p1")).toHaveLength(0);
  });

  it("returns NOT_FOUND for unknown ids", () => {
    expect(() => transition("promise", "nope", "draft", "awaiting_approval", { type: "x" })).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });

  it("logs allocation transitions under the parent promise", () => {
    seedPromise("active");
    replaceAllocationRows("p1", [
      {
        id: "a1",
        promiseId: "p1",
        label: "Rent",
        recipientWallet: "https://ilp.interledger-test.dev/landlord",
        value: "500",
        status: "pending",
        statusToken: "st",
        simulated: false,
      },
    ]);
    transition("allocation", "a1", "pending", "paying", { type: "allocation_paying" });
    expect(listAllocations("p1")[0].status).toBe("paying");
    expect(listEvents("p1")).toMatchObject([{ type: "allocation_paying", payload: { allocationId: "a1" } }]);
  });
});
