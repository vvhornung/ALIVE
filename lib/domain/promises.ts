// Promise lifecycle up to approval: create → payer authorizes on their wallet
// → callback stores the grant → active. Payout lives in payout.ts (next prompt).
import { randomUUID } from "node:crypto";
import { isIsoDate, todayInBogota } from "@/lib/dates";
import {
  getPendingGrant,
  getPromiseByApprovalToken,
  getPromiseById,
  inTransaction,
  insertEvent,
  insertPromise,
  listAllocations,
  saveActiveGrant,
  savePendingGrant,
  setAtRiskReason,
  type PromiseRecord,
} from "@/lib/db";
import { getEnv } from "@/lib/env";
import { fromDecimalString, MoneyError, parseMinor } from "@/lib/money";
import { continueGrant, requestOutgoingGrant, resolveWallet, verifyInteractHash } from "@/lib/op";
import { DomainError } from "./errors";
import { transition } from "./stateMachine";
import { hashSecret, newPublicToken, tokensEqual } from "./tokens";

export type CreatePromiseInput = {
  freelancerWallet: string;
  freelancerName?: string;
  amount: string; // decimal string, e.g. "300.00"
  assetCode: string;
  assetScale?: number; // default 2; checked against the payer wallet at authorize (D3)
  dueAt: string; // YYYY-MM-DD, Bogotá calendar
  description?: string;
  invoiceRef?: string;
};

export function getPromiseOrThrow(id: string): PromiseRecord {
  const promise = getPromiseById(id);
  if (!promise) throw new DomainError("NOT_FOUND", "Promise not found");
  return promise;
}

function fallbackName(walletId: string): string {
  const url = new URL(walletId);
  return `${url.host}${url.pathname}`;
}

export async function createPromise(
  input: CreatePromiseInput,
  now: Date = new Date(),
): Promise<{ promise: PromiseRecord; approvalToken: string; freelancerKey: string }> {
  const assetScale = input.assetScale ?? 2;
  if (!/^[A-Z]{3}$/.test(input.assetCode)) {
    throw new DomainError("VALIDATION_ERROR", "assetCode must be a 3-letter code like USD");
  }
  if (!Number.isInteger(assetScale) || assetScale < 0 || assetScale > 18) {
    throw new DomainError("VALIDATION_ERROR", "assetScale must be an integer between 0 and 18");
  }
  let totalValue: string;
  try {
    totalValue = fromDecimalString(input.amount, assetScale);
  } catch (error) {
    if (error instanceof MoneyError) throw new DomainError("VALIDATION_ERROR", error.message);
    throw error;
  }
  if (parseMinor(totalValue) <= 0n) throw new DomainError("VALIDATION_ERROR", "amount must be greater than 0");
  if (!isIsoDate(input.dueAt)) throw new DomainError("VALIDATION_ERROR", "dueAt must be a date like 2026-10-17");
  if (input.dueAt < todayInBogota(now)) {
    throw new DomainError("VALIDATION_ERROR", "dueAt cannot be in the past (Bogotá time)");
  }

  const freelancer = await resolveWallet(input.freelancerWallet);
  const promise: PromiseRecord = {
    id: randomUUID(),
    freelancerWallet: freelancer.id,
    freelancerName: input.freelancerName?.trim() || freelancer.publicName || fallbackName(freelancer.id),
    payerWallet: null,
    assetCode: input.assetCode,
    assetScale,
    totalValue,
    dueAt: input.dueAt,
    description: input.description?.trim() || null,
    invoiceRef: input.invoiceRef?.trim() || null,
    status: "draft",
    atRiskReason: null,
    approvalToken: newPublicToken(),
    createdAt: now.toISOString(),
  };

  // Returned once; only its sha256 is stored.
  const freelancerKey = newPublicToken();

  inTransaction(() => {
    insertPromise(promise, hashSecret(freelancerKey));
    insertEvent(promise.id, "promise_created", {
      totalValue,
      assetCode: promise.assetCode,
      assetScale,
      dueAt: promise.dueAt,
    });
    transition("promise", promise.id, "draft", "awaiting_approval", { type: "approval_requested" });
  });
  return { promise: { ...promise, status: "awaiting_approval" }, approvalToken: promise.approvalToken, freelancerKey };
}

/** Public lookup for the payer page. Unknown tokens are NOT_FOUND. */
export function getPromiseByApprovalTokenOrThrow(approvalToken: string): PromiseRecord {
  const promise = getPromiseByApprovalToken(approvalToken);
  if (!promise) throw new DomainError("INVALID_APPROVAL_TOKEN", "Approval link not found");
  return promise;
}

/**
 * Payer submits their wallet: resolve it, enforce D3, request the D1 grant and
 * persist the continuation data (encrypted). Returns the consent URL.
 */
export async function startAuthorization(
  promiseId: string,
  approvalToken: string,
  payerWalletUrl: string,
): Promise<{ redirectUrl: string }> {
  const promise = getPromiseOrThrow(promiseId);
  if (!tokensEqual(promise.approvalToken, approvalToken)) {
    throw new DomainError("INVALID_APPROVAL_TOKEN", "Approval link not found");
  }
  const reapproval = isReapprovable(promise);
  if (promise.status !== "awaiting_approval" && !reapproval) {
    throw new DomainError("INVALID_STATE", `Promise is ${promise.status}; it can no longer be approved`);
  }

  const payer = await resolveWallet(payerWalletUrl);
  if (reapproval && promise.payerWallet && payer.id !== promise.payerWallet) {
    throw new DomainError("VALIDATION_ERROR", "Re-approval must come from the same payer wallet");
  }
  if (payer.assetCode !== promise.assetCode || payer.assetScale !== promise.assetScale) {
    throw new DomainError(
      "ASSET_MISMATCH",
      `This promise is in ${promise.assetCode} (scale ${promise.assetScale}) but the wallet uses ` +
        `${payer.assetCode} (scale ${payer.assetScale}). Use a ${promise.assetCode} wallet.`,
    );
  }

  // A re-approval only needs to cover what has not been paid yet (least privilege).
  const limitValue = reapproval ? unpaidValue(promise).toString() : promise.totalValue;
  const pending = await requestOutgoingGrant({
    payer,
    debitAmount: { value: limitValue, assetCode: promise.assetCode, assetScale: promise.assetScale },
    finishUri: `${getEnv().appBaseUrl}/api/grants/callback/${promise.id}`,
  });

  inTransaction(() => {
    savePendingGrant(promise.id, payer.id, pending);
    insertEvent(promise.id, reapproval ? "reapproval_started" : "authorization_started", {
      payerWallet: payer.id,
      limitValue,
    });
  });
  return { redirectUrl: pending.redirectUrl };
}

/**
 * Consent callback with interact_ref: verify the hash (D5), continue the grant,
 * store the access token (encrypted) and activate. Idempotent once active.
 */
export async function completeAuthorization(
  promiseId: string,
  interactRef: string,
  hash: string | undefined,
): Promise<PromiseRecord> {
  const promise = getPromiseOrThrow(promiseId);
  if (promise.status === "active") return promise; // repeated callback; interact_ref is single-use
  const reapproval = isReapprovable(promise);
  if (promise.status !== "awaiting_approval" && !reapproval) {
    throw new DomainError("INVALID_STATE", `Promise is ${promise.status}`);
  }
  const pending = getPendingGrant(promise.id);
  if (!pending || !promise.payerWallet) {
    throw new DomainError("INVALID_STATE", "No authorization in progress for this promise");
  }

  const payer = await resolveWallet(promise.payerWallet);
  const hashOk =
    hash !== undefined &&
    verifyInteractHash({
      clientNonce: pending.clientNonce,
      finishNonce: pending.finishNonce,
      interactRef,
      authServer: payer.authServer,
      hash,
    });
  if (!hashOk) {
    insertEvent(promise.id, "hash_mismatch", { hashPresent: hash !== undefined, strict: getEnv().strictHash });
    if (getEnv().strictHash) throw new DomainError("INVALID_HASH", "Interaction hash did not match");
    console.warn(`[authorize] hash mismatch for promise ${promise.id} (STRICT_HASH=false, continuing)`);
  }

  const grant = await continueGrant({
    continueUri: pending.continueUri,
    continueToken: pending.continueToken,
    interactRef,
  });

  inTransaction(() => {
    saveActiveGrant(promise.id, { accessToken: grant.accessToken, manageUri: grant.manageUri });
    transition("promise", promise.id, reapproval ? "at_risk" : "awaiting_approval", "active", {
      type: reapproval ? "reapproved" : "payer_approved",
      payload: { payerWallet: promise.payerWallet, hashVerified: hashOk },
    });
    if (reapproval) setAtRiskReason(promise.id, null);
  });
  return { ...promise, status: "active" };
}

/** Callback without interact_ref: the payer declined. Status does not change. */
export function rejectAuthorization(promiseId: string): PromiseRecord {
  const promise = getPromiseOrThrow(promiseId);
  if (promise.status === "awaiting_approval" || isReapprovable(promise)) {
    insertEvent(promise.id, "payer_rejected", { payerWallet: promise.payerWallet });
  }
  return promise;
}

/** at_risk because of a REAL grant problem; simulated revocations go through revoke-sim. */
function isReapprovable(promise: PromiseRecord): boolean {
  return (
    promise.status === "at_risk" &&
    (promise.atRiskReason === "grant_revoked" || promise.atRiskReason === "rotation_failed")
  );
}

function unpaidValue(promise: PromiseRecord): bigint {
  const paid = listAllocations(promise.id)
    .filter((a) => a.status === "paid")
    .reduce((acc, a) => acc + parseMinor(a.value), 0n);
  return parseMinor(promise.totalValue) - paid;
}
