// Payment day (AGENTS §10.4, ARCHITECTURE D2, D6–D10). One grant, one
// fixed-debit outgoing payment per allocation, processed sequentially.
// Resumable: every step persists its result before the next call, and an
// outgoing payment is never created twice for the same quote.
import { randomUUID } from "node:crypto";
import {
  getActiveGrant,
  getLatestEventAt,
  getLatestPayment,
  getPayment,
  inTransaction,
  insertEvent,
  insertPayment,
  listAllocations,
  saveActiveGrant,
  setAtRiskReason,
  updatePaymentData,
  type AllocationRecord,
  type PaymentRecord,
  type PromiseRecord,
} from "@/lib/db";
import { parseMinor, toDisplay, type Amount } from "@/lib/money";
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
  requestQuoteGrant,
  resolveWallet,
  rotateToken,
  type ResolvedWallet,
} from "@/lib/op";
import { DomainError } from "./errors";
import { getPromiseOrThrow } from "./promises";
import { transition } from "./stateMachine";

/** Execute may take over an `executing` promise whose last event is older than this. */
export const STALE_EXECUTION_MS = 5 * 60_000;

export type ExecutionResult = { status: PromiseRecord["status"] };

type RunContext = {
  promise: PromiseRecord;
  payer: ResolvedWallet;
  outgoingToken: string;
  quoteToken: string;
};

// ---------- lock (synchronous, D8) ----------

/**
 * Takes the execution lock. Synchronous on purpose: better-sqlite3 runs in
 * this thread, so no other request can interleave between check and write.
 */
export function lockForExecution(promiseId: string, now: Date = new Date()): void {
  const promise = getPromiseOrThrow(promiseId);
  if (listAllocations(promiseId).length === 0) {
    throw new DomainError("VALIDATION_ERROR", "Add at least one allocation before payment day");
  }
  switch (promise.status) {
    case "active":
      transition("promise", promiseId, "active", "executing", { type: "execution_started" });
      return;
    case "partially_failed":
      transition("promise", promiseId, "partially_failed", "executing", { type: "execution_retried" });
      return;
    case "executing": {
      const lastEventAt = getLatestEventAt(promiseId);
      if (lastEventAt && now.getTime() - Date.parse(lastEventAt) > STALE_EXECUTION_MS) {
        insertEvent(promiseId, "execution_recovered", { lastEventAt });
        return;
      }
      throw new DomainError("INVALID_STATE", "Payment day is already running for this promise");
    }
    case "at_risk":
      throw new DomainError("INVALID_STATE", "Payer authorization at risk");
    default:
      throw new DomainError("INVALID_STATE", `Promise is ${promise.status}; there is nothing to execute`);
  }
}

// ---------- run (asynchronous) ----------

/** Runs payment day after lockForExecution(). Never throws; always leaves a final status. */
export async function runExecution(promiseId: string): Promise<ExecutionResult> {
  try {
    const promise = getPromiseOrThrow(promiseId);
    const grant = getActiveGrant(promiseId);
    if (!grant || !promise.payerWallet) {
      throw new DomainError("INVALID_STATE", "Promise has no payer authorization");
    }

    // D6: access tokens live ~10 min; rotate right before using it.
    let outgoingToken: string;
    try {
      const rotated = await rotateToken({ manageUri: grant.manageUri, accessToken: grant.accessToken });
      saveActiveGrant(promiseId, { accessToken: rotated.accessToken, manageUri: rotated.manageUri });
      insertEvent(promiseId, "token_rotated", { expiresIn: rotated.expiresIn ?? null });
      outgoingToken = rotated.accessToken;
    } catch (error) {
      const reason = isRevocation(error) ? "grant_revoked" : "rotation_failed";
      inTransaction(() => {
        transition("promise", promiseId, "executing", "at_risk", {
          type: reason,
          payload: { error: safeErrorMessage(error) },
        });
        setAtRiskReason(promiseId, reason);
      });
      return { status: "at_risk" };
    }

    const payer = await resolveWallet(promise.payerWallet);
    const quoteToken = await requestQuoteGrant(payer); // D7: in memory only
    const ctx: RunContext = { promise, payer, outgoingToken, quoteToken };

    for (const allocation of listAllocations(promiseId)) {
      if (allocation.status === "paid") continue;
      await runAllocation(ctx, allocation);
    }
  } catch (error) {
    console.error(`[payout] promise ${promiseId}: ${safeErrorMessage(error)}`);
    insertEvent(promiseId, "execution_error", { error: safeErrorMessage(error) });
  }
  return { status: finish(promiseId) };
}

/** completed if every allocation is paid; otherwise partially_failed. */
function finish(promiseId: string): PromiseRecord["status"] {
  const promise = getPromiseOrThrow(promiseId);
  if (promise.status !== "executing") return promise.status;
  const allocations = listAllocations(promiseId);
  const paid = allocations.filter((a) => a.status === "paid").length;
  const to = paid === allocations.length ? "completed" : "partially_failed";
  transition("promise", promiseId, "executing", to, {
    type: to === "completed" ? "execution_completed" : "execution_partially_failed",
    payload: { paid, total: allocations.length },
  });
  return to;
}

// ---------- one allocation (resumable, D9) ----------

async function runAllocation(ctx: RunContext, allocation: AllocationRecord): Promise<void> {
  const latest = getLatestPayment(allocation.id);

  if (allocation.status === "pending" || allocation.status === "failed") {
    transition("allocation", allocation.id, allocation.status, "paying", {
      type: allocation.status === "failed" ? "allocation_retried" : "allocation_paying",
    });
  }
  if (latest?.step === "completed") {
    // Crash between payment completion and allocation update.
    transition("allocation", allocation.id, "paying", "paid", { type: "allocation_paid" });
    return;
  }

  let payment: PaymentRecord;
  if (!latest || latest.step === "failed") {
    payment = newPayment(ctx.promise, allocation, (latest?.attempt ?? 0) + 1);
  } else {
    payment = latest; // resume from the persisted step
  }

  try {
    await advance(ctx, allocation, payment, payment.id === latest?.id);
  } catch (error) {
    failAllocation(ctx, allocation, getPayment(payment.id), error);
  }
}

function newPayment(promise: PromiseRecord, allocation: AllocationRecord, attempt: number): PaymentRecord {
  const payment: PaymentRecord = {
    id: randomUUID(),
    allocationId: allocation.id,
    idempotencyKey: `${promise.id}:${allocation.id}:${attempt}`,
    attempt,
    step: "created",
    incomingPaymentUrl: null,
    quoteUrl: null,
    outgoingPaymentUrl: null,
    debitValue: null,
    receiveValue: null,
    receiveAssetCode: null,
    receiveAssetScale: null,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  inTransaction(() => {
    insertPayment(payment);
    insertEvent(promise.id, "payment_created", { paymentId: payment.id, allocationId: allocation.id, attempt });
  });
  return payment;
}

async function advance(
  ctx: RunContext,
  allocation: AllocationRecord,
  initial: PaymentRecord,
  resumed: boolean,
): Promise<void> {
  const { promise, payer } = ctx;
  let payment = initial;
  const reload = () => {
    const fresh = getPayment(initial.id);
    if (!fresh) throw new DomainError("NOT_FOUND", "Payment row disappeared");
    payment = fresh;
  };
  const debitAmount: Amount = { value: allocation.value, assetCode: promise.assetCode, assetScale: promise.assetScale };

  // Retry guard before touching any wallet (S9: failed payments may still count against the limit).
  if (payment.step === "created" && payment.attempt > 1) await assertGrantCovers(ctx, allocation);

  const recipient = await resolveWallet(allocation.recipientWallet);
  const incomingToken = await requestIncomingGrant(recipient); // not stored; re-requested on resume

  if (payment.step === "created") {
    const incoming = await createOpenIncomingPayment({
      recipient,
      accessToken: incomingToken,
      metadata: { promiseId: promise.id, allocationId: allocation.id, invoiceRef: promise.invoiceRef },
    });
    inTransaction(() => {
      updatePaymentData(payment.id, { incomingPaymentUrl: incoming.id });
      transition("payment", payment.id, "created", "incoming_created", { type: "payment_incoming_created" });
    });
    reload();
  }

  if (payment.step === "incoming_created") {
    const quote = await createFixedDebitQuote({
      payer,
      accessToken: ctx.quoteToken,
      incomingPaymentUrl: requireValue(payment.incomingPaymentUrl, "incoming payment"),
      debitAmount,
    });
    inTransaction(() => {
      updatePaymentData(payment.id, quoteFields(quote));
      transition("payment", payment.id, "incoming_created", "quoted", {
        type: "payment_quoted",
        payload: { debit: toDisplay(quote.debitAmount), receive: toDisplay(quote.receiveAmount) },
      });
    });
    reload();
    resumed = false; // the quote is fresh
  }

  if (payment.step === "quoted") {
    const quoteUrl = requireValue(payment.quoteUrl, "quote");
    // Crash-safe idempotency: an outgoing payment may exist for this quote already.
    const existing = resumed
      ? await findOutgoingPaymentByQuote({ payer, accessToken: ctx.outgoingToken, quoteUrl })
      : undefined;
    if (existing) {
      inTransaction(() => {
        updatePaymentData(payment.id, { outgoingPaymentUrl: existing.id });
        transition("payment", payment.id, "quoted", "submitted", { type: "payment_adopted" });
      });
    } else {
      let quoteId = quoteUrl;
      if (resumed) {
        const quote = await getQuote({ url: quoteUrl, accessToken: ctx.quoteToken });
        if (isQuoteExpired(quote)) {
          const fresh = await createFixedDebitQuote({
            payer,
            accessToken: ctx.quoteToken,
            incomingPaymentUrl: requireValue(payment.incomingPaymentUrl, "incoming payment"),
            debitAmount,
          });
          inTransaction(() => {
            updatePaymentData(payment.id, quoteFields(fresh));
            insertEvent(promise.id, "quote_refreshed", {
              paymentId: payment.id,
              old: { debit: toDisplay(quote.debitAmount), receive: toDisplay(quote.receiveAmount) },
              new: { debit: toDisplay(fresh.debitAmount), receive: toDisplay(fresh.receiveAmount) },
            });
          });
          quoteId = fresh.id;
        }
      }
      let outgoingUrl: string;
      try {
        const outgoing = await createOutgoingPayment({
          payer,
          accessToken: ctx.outgoingToken,
          quoteId,
          metadata: { promiseId: promise.id, allocationId: allocation.id, paymentId: payment.id },
        });
        outgoingUrl = outgoing.id;
      } catch (error) {
        if (error instanceof OpError && error.status === 403) {
          throw new DomainError(
            "GRANT_LIMIT_EXCEEDED",
            "The payer's approval does not cover this payment (limit reached). The payer must approve again.",
          );
        }
        throw error;
      }
      inTransaction(() => {
        updatePaymentData(payment.id, { outgoingPaymentUrl: outgoingUrl });
        transition("payment", payment.id, "quoted", "submitted", { type: "payment_submitted" });
      });
    }
    reload();
  }

  if (payment.step === "submitted") {
    const result = await pollOutgoing({
      outgoingUrl: requireValue(payment.outgoingPaymentUrl, "outgoing payment"),
      outgoingToken: ctx.outgoingToken,
      incomingUrl: requireValue(payment.incomingPaymentUrl, "incoming payment"),
      incomingToken,
      quoteReceiveAmount: {
        value: requireValue(payment.receiveValue, "receive amount"),
        assetCode: requireValue(payment.receiveAssetCode, "receive asset"),
        assetScale: requireValue(payment.receiveAssetScale, "receive scale"),
      },
    });
    if (result.status === "failed") {
      throw new OpError("outgoing.poll", "The wallet reported the payment as failed");
    }
    if (result.status === "timeout") {
      // Not failed: the payment may still complete. Stay submitted/paying; a re-run only polls.
      insertEvent(promise.id, "payment_timeout", { paymentId: payment.id, attempts: result.attempts });
      return;
    }
    inTransaction(() => {
      updatePaymentData(payment.id, { completedAt: new Date().toISOString(), error: null });
      transition("payment", payment.id, "submitted", "completed", {
        type: "payment_completed",
        payload: { received: toDisplay(result.incoming.receivedAmount) },
      });
      transition("allocation", allocation.id, "paying", "paid", { type: "allocation_paid" });
    });
    try {
      await completeIncomingPayment({
        url: requireValue(payment.incomingPaymentUrl, "incoming payment"),
        accessToken: incomingToken,
      });
    } catch (error) {
      console.warn(`[payout] incoming complete skipped for payment ${payment.id}: ${safeErrorMessage(error)}`);
    }
  }
}

/**
 * Records a failure. A payment that may already have moved money (submitted,
 * or quoted with an unclear create error) is NOT marked failed: it stays
 * resumable, so a retry polls or adopts instead of paying twice.
 */
function failAllocation(
  ctx: RunContext,
  allocation: AllocationRecord,
  payment: PaymentRecord | undefined,
  error: unknown,
): void {
  const message = safeErrorMessage(error);
  console.warn(`[payout] allocation ${allocation.id} failed: ${message}`);
  const mayHaveMovedMoney =
    payment !== undefined &&
    (payment.step === "submitted" ||
      (payment.step === "quoted" && !(error instanceof DomainError) && !isDefiniteRejection(error))) &&
    !(error instanceof OpError && error.step === "outgoing.poll");

  inTransaction(() => {
    if (payment) updatePaymentData(payment.id, { error: message });
    if (mayHaveMovedMoney) {
      insertEvent(ctx.promise.id, "payment_unresolved", { paymentId: payment?.id, error: message });
      return; // allocation stays `paying`; the promise ends partially_failed; re-run resumes
    }
    if (payment && payment.step !== "completed" && payment.step !== "failed") {
      transition("payment", payment.id, payment.step, "failed", {
        type: "payment_failed",
        payload: { error: message, code: error instanceof DomainError ? error.code : "OP_ERROR" },
      });
    }
    transition("allocation", allocation.id, "paying", "failed", { type: "allocation_failed" });
  });
}

/** Retry guard: is there room left under the grant's debitAmount limit? */
async function assertGrantCovers(ctx: RunContext, allocation: AllocationRecord): Promise<void> {
  let spentValue: bigint;
  try {
    const spent = await getGrantSpentAmounts({ payer: ctx.payer, accessToken: ctx.outgoingToken });
    spentValue = spent.spentDebitAmount ? parseMinor(spent.spentDebitAmount.value) : 0n;
  } catch (error) {
    console.warn(`[payout] grant spent check unavailable: ${safeErrorMessage(error)}`);
    return; // fall back to the wallet rejecting the payment (mapped to GRANT_LIMIT_EXCEEDED)
  }
  const limit = parseMinor(ctx.promise.totalValue);
  const remaining = limit > spentValue ? limit - spentValue : 0n;
  if (parseMinor(allocation.value) > remaining) {
    const fmt = (v: bigint) =>
      toDisplay({ value: v.toString(), assetCode: ctx.promise.assetCode, assetScale: ctx.promise.assetScale });
    throw new DomainError(
      "GRANT_LIMIT_EXCEEDED",
      `The payer's approval has ${fmt(remaining)} left of ${fmt(limit)}; this payment needs ` +
        `${fmt(parseMinor(allocation.value))}. The payer must approve again.`,
    );
  }
}

// ---------- helpers ----------

function quoteFields(quote: { id: string; debitAmount: Amount; receiveAmount: Amount }) {
  return {
    quoteUrl: quote.id,
    debitValue: quote.debitAmount.value,
    receiveValue: quote.receiveAmount.value,
    receiveAssetCode: quote.receiveAmount.assetCode,
    receiveAssetScale: quote.receiveAmount.assetScale,
  };
}

function requireValue<T>(value: T | null, what: string): T {
  if (value === null) throw new DomainError("INVALID_STATE", `Payment is missing its ${what}`);
  return value;
}

const REVOCATION_CODES = new Set(["invalid_grant", "access_denied", "invalid_rotation", "invalid_continuation"]);

/** 401/403 or a GNAP grant error on rotation means the payer's grant is gone. */
export function isRevocation(error: unknown): boolean {
  if (!(error instanceof OpError)) return false;
  if (error.status === 401 || error.status === 403) return true;
  if (error.code && REVOCATION_CODES.has(error.code)) return true;
  return /revok/i.test(error.description ?? "");
}

/** 4xx from the wallet: the request was refused, nothing was created. */
function isDefiniteRejection(error: unknown): boolean {
  return error instanceof OpError && error.status !== undefined && error.status >= 400 && error.status < 500;
}

/** User-safe, token-free error text for payments.error and events. */
export function safeErrorMessage(error: unknown): string {
  let message: string;
  if (error instanceof DomainError) message = `${error.code}: ${error.message}`;
  else if (error instanceof OpError) message = error.toLogString();
  else message = "Unexpected error";
  return message.slice(0, 500);
}
