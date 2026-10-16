import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveGrant,
  getLatestPayment,
  getPromiseById,
  insertPayment,
  listAllocations,
  listEvents,
  listPaymentsForPromise,
  resetDbForTests,
  saveActiveGrant,
  savePendingGrant,
  type PaymentRecord,
  type PaymentStep,
} from "@/lib/db";
import {
  completeIncomingPayment,
  createFixedDebitQuote,
  createOpenIncomingPayment,
  createOutgoingPayment,
  findOutgoingPaymentByQuote,
  getGrantSpentAmounts,
  getQuote,
  isQuoteExpired,
  OpError,
  pollOutgoing,
  requestIncomingGrant,
  requestOutgoingGrant,
  requestQuoteGrant,
  resolveWallet,
  rotateToken,
} from "@/lib/op";
import { PENDING_GRANT, resolveByName } from "@/test/opMock";
import { replaceAllocations } from "./allocations";
import { lockForExecution, runExecution, STALE_EXECUTION_MS } from "./payout";
import { createPromise } from "./promises";
import { transition } from "./stateMachine";

vi.mock("@/lib/op", async () => ({
  ...(await vi.importActual<typeof import("@/lib/op/errors")>("@/lib/op/errors")),
  resolveWallet: vi.fn(),
  requestOutgoingGrant: vi.fn(),
  continueGrant: vi.fn(),
  verifyInteractHash: vi.fn(),
  rotateToken: vi.fn(),
  requestQuoteGrant: vi.fn(),
  requestIncomingGrant: vi.fn(),
  createOpenIncomingPayment: vi.fn(),
  createFixedDebitQuote: vi.fn(),
  getQuote: vi.fn(),
  isQuoteExpired: vi.fn(),
  createOutgoingPayment: vi.fn(),
  findOutgoingPaymentByQuote: vi.fn(),
  pollOutgoing: vi.fn(),
  completeIncomingPayment: vi.fn(),
  getGrantSpentAmounts: vi.fn(),
}));

/** Typed stand-in for SDK resources (tests only need a few fields). */
const fake = <T>(value: object): T => value as T;
type Quote = Awaited<ReturnType<typeof createFixedDebitQuote>>;
const usd = (value: string) => ({ value, assetCode: "USD", assetScale: 2 });

let seq = 0;
const quoteFor = (debit: { value: string }, id = `https://rs.test/quotes/q${++seq}`): Quote =>
  fake<Quote>({ id, debitAmount: usd(debit.value), receiveAmount: usd(debit.value), expiresAt: "2999-01-01T00:00:00Z" });

const NOW = new Date("2026-10-16T15:00:00Z");

async function activePromise(amounts: string[] = ["1.00", "1.50", "0.50"]) {
  const total = amounts.reduce((acc, a) => acc + Number.parseInt(a.replace(".", ""), 10), 0);
  const { promise } = await createPromise(
    {
      freelancerWallet: "https://ilp.interledger-test.dev/ana",
      amount: (total / 100).toFixed(2), // test-only fixture math on integers
      assetCode: "USD",
      dueAt: "2026-10-17",
      invoiceRef: "INV-1",
    },
    NOW,
  );
  await replaceAllocations(
    promise.id,
    amounts.map((amount, i) => ({
      label: ["Me", "Rent", "PILA"][i] ?? `R${i}`,
      recipientWallet: `https://ilp.interledger-test.dev/r${i}`,
      amount,
      simulated: i === 2,
    })),
  );
  // Simulate an approved promise.
  savePendingGrant(promise.id, "https://ilp.interledger-test.dev/payer", PENDING_GRANT);
  saveActiveGrant(promise.id, { accessToken: "SECRET-access", manageUri: "https://auth.test/token/SECRET-manage" });
  transition("promise", promise.id, "awaiting_approval", "active", { type: "payer_approved" });
  return getPromiseById(promise.id)!;
}

async function execute(promiseId: string) {
  lockForExecution(promiseId);
  return runExecution(promiseId);
}

function seedPayment(allocationId: string, promiseId: string, step: PaymentStep, extra: Partial<PaymentRecord> = {}) {
  insertPayment({
    id: `pay-${allocationId}`,
    allocationId,
    idempotencyKey: `${promiseId}:${allocationId}:1`,
    attempt: 1,
    step,
    incomingPaymentUrl: "https://rs.test/incoming/seeded",
    quoteUrl: step === "created" || step === "incoming_created" ? null : "https://rs.test/quotes/seeded",
    outgoingPaymentUrl: step === "submitted" ? "https://rs.test/outgoing/seeded" : null,
    debitValue: "100",
    receiveValue: "100",
    receiveAssetCode: "USD",
    receiveAssetScale: 2,
    error: null,
    createdAt: NOW.toISOString(),
    completedAt: null,
    ...extra,
  });
}

/** Puts a promise in partially_failed with allocation[0] paying and a seeded payment at `step`. */
async function interruptedAt(step: PaymentStep) {
  const promise = await activePromise(["1.00"]);
  const [allocation] = listAllocations(promise.id);
  transition("promise", promise.id, "active", "executing", { type: "test" });
  transition("promise", promise.id, "executing", "partially_failed", { type: "test" });
  transition("allocation", allocation.id, "pending", "paying", { type: "test" });
  seedPayment(allocation.id, promise.id, step);
  return { promise, allocation };
}

beforeEach(() => {
  resetDbForTests();
  seq = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(resolveWallet).mockReset().mockImplementation(resolveByName());
  vi.mocked(requestOutgoingGrant).mockReset().mockResolvedValue(PENDING_GRANT);
  vi.mocked(rotateToken).mockReset().mockResolvedValue({
    accessToken: "SECRET-rotated",
    manageUri: "https://auth.test/token/SECRET-manage-2",
    expiresIn: 600,
  });
  vi.mocked(requestQuoteGrant).mockReset().mockResolvedValue("SECRET-quote-token");
  vi.mocked(requestIncomingGrant).mockReset().mockResolvedValue("SECRET-incoming-token");
  vi.mocked(createOpenIncomingPayment)
    .mockReset()
    .mockImplementation(async () => fake({ id: `https://rs.test/incoming/i${++seq}` }));
  vi.mocked(createFixedDebitQuote).mockReset().mockImplementation(async (args) => quoteFor(args.debitAmount));
  vi.mocked(getQuote).mockReset().mockImplementation(async (args) => quoteFor(usd("100"), args.url));
  vi.mocked(isQuoteExpired).mockReset().mockReturnValue(false);
  vi.mocked(createOutgoingPayment)
    .mockReset()
    .mockImplementation(async () => fake({ id: `https://rs.test/outgoing/o${++seq}` }));
  vi.mocked(findOutgoingPaymentByQuote).mockReset().mockResolvedValue(undefined);
  vi.mocked(pollOutgoing)
    .mockReset()
    .mockImplementation(async (args) =>
      fake({
        status: "completed",
        attempts: 1,
        outgoing: { failed: false },
        incoming: { receivedAmount: args.quoteReceiveAmount },
      }),
    );
  vi.mocked(completeIncomingPayment).mockReset().mockResolvedValue(fake({}));
  vi.mocked(getGrantSpentAmounts).mockReset().mockResolvedValue({ spentDebitAmount: null, spentReceiveAmount: null });
});

describe("happy path", () => {
  it("pays every allocation with one rotated token and completes the promise", async () => {
    const promise = await activePromise();
    const result = await execute(promise.id);

    expect(result.status).toBe("completed");
    expect(listAllocations(promise.id).map((a) => a.status)).toEqual(["paid", "paid", "paid"]);
    expect(createOutgoingPayment).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(createOutgoingPayment).mock.calls) {
      expect(call[0].accessToken).toBe("SECRET-rotated");
    }
    // Fixed-debit quotes: debit = allocation value in the payer asset (D2).
    expect(vi.mocked(createFixedDebitQuote).mock.calls.map((c) => c[0].debitAmount.value)).toEqual(["100", "150", "50"]);
    expect(vi.mocked(createOpenIncomingPayment).mock.calls[0][0].metadata).toMatchObject({
      promiseId: promise.id,
      invoiceRef: "INV-1",
    });
    expect(getActiveGrant(promise.id)?.accessToken).toBe("SECRET-rotated");
    const payments = listPaymentsForPromise(promise.id);
    expect(payments.every((p) => p.step === "completed" && p.completedAt)).toBe(true);
    expect(payments[0].idempotencyKey).toBe(`${promise.id}:${payments[0].allocationId}:1`);
    expect(JSON.stringify(listEvents(promise.id))).not.toContain("SECRET-");
  });
});

describe("resume (D9) — never a second outgoing payment", () => {
  it("from incoming_created: skips the incoming payment, quotes and pays", async () => {
    const { promise } = await interruptedAt("incoming_created");
    expect((await execute(promise.id)).status).toBe("completed");
    expect(createOpenIncomingPayment).not.toHaveBeenCalled();
    expect(vi.mocked(createFixedDebitQuote).mock.calls[0][0].incomingPaymentUrl).toBe("https://rs.test/incoming/seeded");
    expect(createOutgoingPayment).toHaveBeenCalledTimes(1);
  });

  it("from quoted: looks for an existing outgoing first, then pays with the stored quote", async () => {
    const { promise } = await interruptedAt("quoted");
    expect((await execute(promise.id)).status).toBe("completed");
    expect(findOutgoingPaymentByQuote).toHaveBeenCalledTimes(1);
    expect(createFixedDebitQuote).not.toHaveBeenCalled();
    expect(vi.mocked(createOutgoingPayment).mock.calls[0][0].quoteId).toBe("https://rs.test/quotes/seeded");
  });

  it("from quoted: adopts an outgoing payment that already exists for the quote", async () => {
    const { promise, allocation } = await interruptedAt("quoted");
    vi.mocked(findOutgoingPaymentByQuote).mockResolvedValue(fake({ id: "https://rs.test/outgoing/already" }));
    expect((await execute(promise.id)).status).toBe("completed");
    expect(createOutgoingPayment).not.toHaveBeenCalled();
    expect(getLatestPayment(allocation.id)?.outgoingPaymentUrl).toBe("https://rs.test/outgoing/already");
    expect(listEvents(promise.id).map((e) => e.type)).toContain("payment_adopted");
  });

  it("from quoted with an expired quote: re-quotes and logs old and new amounts", async () => {
    const { promise } = await interruptedAt("quoted");
    vi.mocked(isQuoteExpired).mockReturnValue(true);
    expect((await execute(promise.id)).status).toBe("completed");
    expect(createFixedDebitQuote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createOutgoingPayment).mock.calls[0][0].quoteId).not.toBe("https://rs.test/quotes/seeded");
    const refreshed = listEvents(promise.id).find((e) => e.type === "quote_refreshed");
    expect(refreshed?.payload).toMatchObject({ old: { debit: "1.00 USD" }, new: { debit: "1.00 USD" } });
  });

  it("from submitted: only polls", async () => {
    const { promise } = await interruptedAt("submitted");
    expect((await execute(promise.id)).status).toBe("completed");
    expect(createOpenIncomingPayment).not.toHaveBeenCalled();
    expect(createFixedDebitQuote).not.toHaveBeenCalled();
    expect(createOutgoingPayment).not.toHaveBeenCalled();
    expect(vi.mocked(pollOutgoing).mock.calls[0][0].outgoingUrl).toBe("https://rs.test/outgoing/seeded");
  });

  it("an unclear create error (5xx) leaves the payment resumable, and the retry adopts instead of paying twice", async () => {
    const promise = await activePromise(["1.00"]);
    vi.mocked(createOutgoingPayment).mockRejectedValueOnce(new OpError("outgoing.create", "Bad gateway", { status: 502 }));
    expect((await execute(promise.id)).status).toBe("partially_failed");
    const [allocation] = listAllocations(promise.id);
    expect(allocation.status).toBe("paying");
    expect(getLatestPayment(allocation.id)?.step).toBe("quoted");

    vi.mocked(findOutgoingPaymentByQuote).mockResolvedValue(fake({ id: "https://rs.test/outgoing/created-anyway" }));
    expect((await execute(promise.id)).status).toBe("completed");
    expect(createOutgoingPayment).toHaveBeenCalledTimes(1);
    expect(listPaymentsForPromise(promise.id)).toHaveLength(1);
  });

  it("a poll timeout keeps the payment submitted; the re-run only polls", async () => {
    const promise = await activePromise(["1.00"]);
    vi.mocked(pollOutgoing).mockResolvedValueOnce(
      fake({ status: "timeout", attempts: 20, outgoing: { failed: false }, incoming: { receivedAmount: usd("0") } }),
    );
    expect((await execute(promise.id)).status).toBe("partially_failed");
    const [allocation] = listAllocations(promise.id);
    expect(allocation.status).toBe("paying");
    expect(getLatestPayment(allocation.id)?.step).toBe("submitted");

    expect((await execute(promise.id)).status).toBe("completed");
    expect(createOutgoingPayment).toHaveBeenCalledTimes(1);
  });
});

describe("failures and retries", () => {
  it("a definite rejection fails the allocation, continues with the rest → partially_failed", async () => {
    const promise = await activePromise();
    vi.mocked(createFixedDebitQuote).mockRejectedValueOnce(
      new OpError("quote.create", "Invalid receiver", { status: 400, description: "invalid receiver" }),
    );
    expect((await execute(promise.id)).status).toBe("partially_failed");
    expect(listAllocations(promise.id).map((a) => a.status)).toEqual(["failed", "paid", "paid"]);
    const failed = listPaymentsForPromise(promise.id).find((p) => p.step === "failed");
    expect(failed?.error).toContain("status=400");
    expect(failed?.error).not.toContain("SECRET");
  });

  it("retry after a failure creates attempt 2 with a new idempotency key", async () => {
    const promise = await activePromise(["1.00"]);
    vi.mocked(createOutgoingPayment).mockRejectedValueOnce(new OpError("outgoing.create", "Bad request", { status: 400 }));
    expect((await execute(promise.id)).status).toBe("partially_failed");
    expect((await execute(promise.id)).status).toBe("completed");
    const [allocation] = listAllocations(promise.id);
    const payments = listPaymentsForPromise(promise.id);
    expect(payments.map((p) => [p.attempt, p.step])).toEqual([
      [1, "failed"],
      [2, "completed"],
    ]);
    expect(payments[1].idempotencyKey).toBe(`${promise.id}:${allocation.id}:2`);
    expect(listEvents(promise.id).map((e) => e.type)).toContain("allocation_retried");
  });

  it("the wallet reporting the payment as failed → payment and allocation failed", async () => {
    const promise = await activePromise(["1.00"]);
    vi.mocked(pollOutgoing).mockResolvedValueOnce(
      fake({ status: "failed", attempts: 2, outgoing: { failed: true }, incoming: { receivedAmount: usd("0") } }),
    );
    expect((await execute(promise.id)).status).toBe("partially_failed");
    const [allocation] = listAllocations(promise.id);
    expect(allocation.status).toBe("failed");
    expect(getLatestPayment(allocation.id)?.step).toBe("failed");
  });

  it("retry fails with GRANT_LIMIT_EXCEEDED when the grant has no room left (no wallet calls)", async () => {
    const promise = await activePromise(["1.00"]);
    vi.mocked(createOutgoingPayment).mockRejectedValueOnce(new OpError("outgoing.create", "Bad request", { status: 400 }));
    await execute(promise.id);
    vi.mocked(getGrantSpentAmounts).mockResolvedValue({ spentDebitAmount: usd("100"), spentReceiveAmount: null });
    vi.mocked(createOpenIncomingPayment).mockClear();
    expect((await execute(promise.id)).status).toBe("partially_failed");
    const payments = listPaymentsForPromise(promise.id);
    expect(payments.map((p) => [p.attempt, p.step])).toEqual([
      [1, "failed"],
      [2, "failed"],
    ]);
    expect(payments[1].error).toContain("GRANT_LIMIT_EXCEEDED");
    expect(payments[1].error).toContain("0.00 USD left of 1.00 USD");
    expect(createOpenIncomingPayment).not.toHaveBeenCalled();
    expect(listAllocations(promise.id)[0].status).toBe("failed");
  });

  it("a 403 from the wallet on create is reported as GRANT_LIMIT_EXCEEDED", async () => {
    const promise = await activePromise(["1.00"]);
    vi.mocked(createOutgoingPayment).mockRejectedValueOnce(new OpError("outgoing.create", "Forbidden", { status: 403 }));
    await execute(promise.id);
    expect(listPaymentsForPromise(promise.id)[0].error).toContain("GRANT_LIMIT_EXCEEDED");
  });
});

describe("lock, rotation and at_risk", () => {
  it("the lock blocks a concurrent execute", async () => {
    const promise = await activePromise();
    lockForExecution(promise.id);
    expect(() => lockForExecution(promise.id)).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
  });

  it("a stale executing lock (> 5 min since the last event) is recovered", async () => {
    const promise = await activePromise(["1.00"]);
    lockForExecution(promise.id);
    const later = new Date(Date.now() + STALE_EXECUTION_MS + 1000);
    expect(() => lockForExecution(promise.id, later)).not.toThrow();
    expect(listEvents(promise.id).map((e) => e.type)).toContain("execution_recovered");
    expect((await runExecution(promise.id)).status).toBe("completed");
  });

  it("rotation rejected with 401 → at_risk (grant_revoked), nothing paid", async () => {
    const promise = await activePromise();
    vi.mocked(rotateToken).mockRejectedValue(new OpError("token.rotate", "Unauthorized", { status: 401 }));
    expect((await execute(promise.id)).status).toBe("at_risk");
    expect(getPromiseById(promise.id)?.atRiskReason).toBe("grant_revoked");
    expect(createOpenIncomingPayment).not.toHaveBeenCalled();
    expect(listEvents(promise.id).map((e) => e.type)).toContain("grant_revoked");
  });

  it("rotation failing for another reason → at_risk (rotation_failed)", async () => {
    const promise = await activePromise();
    vi.mocked(rotateToken).mockRejectedValue(new OpError("token.rotate", "Service unavailable", { status: 503 }));
    expect((await execute(promise.id)).status).toBe("at_risk");
    expect(getPromiseById(promise.id)?.atRiskReason).toBe("rotation_failed");
  });

  it("execute on at_risk → 409 'Payer authorization at risk'", async () => {
    const promise = await activePromise();
    vi.mocked(rotateToken).mockRejectedValue(new OpError("token.rotate", "Unauthorized", { status: 401 }));
    await execute(promise.id);
    expect(() => lockForExecution(promise.id)).toThrow(
      expect.objectContaining({ code: "INVALID_STATE", httpStatus: 409, message: "Payer authorization at risk" }),
    );
  });

  it("refuses to execute without allocations", async () => {
    const promise = await activePromise();
    await replaceAllocations(promise.id, []);
    expect(() => lockForExecution(promise.id)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});
