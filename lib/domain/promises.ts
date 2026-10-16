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
  saveActiveGrant,
  savePendingGrant,
  type PromiseRecord,
} from "@/lib/db";
import { getEnv } from "@/lib/env";
import { fromDecimalString, MoneyError, parseMinor } from "@/lib/money";
import { continueGrant, requestOutgoingGrant, resolveWallet, verifyInteractHash } from "@/lib/op";
import { DomainError } from "./errors";
import { transition } from "./stateMachine";
import { newPublicToken, tokensEqual } from "./tokens";

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
): Promise<{ promise: PromiseRecord; approvalToken: string }> {
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
    approvalToken: newPublicToken(),
    createdAt: now.toISOString(),
  };

  inTransaction(() => {
    insertPromise(promise);
    insertEvent(promise.id, "promise_created", {
      totalValue,
      assetCode: promise.assetCode,
      assetScale,
      dueAt: promise.dueAt,
    });
    transition("promise", promise.id, "draft", "awaiting_approval", { type: "approval_requested" });
  });
  return { promise: { ...promise, status: "awaiting_approval" }, approvalToken: promise.approvalToken };
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
  if (promise.status !== "awaiting_approval") {
    throw new DomainError("INVALID_STATE", `Promise is ${promise.status}; it can no longer be approved`);
  }

  const payer = await resolveWallet(payerWalletUrl);
  if (payer.assetCode !== promise.assetCode || payer.assetScale !== promise.assetScale) {
    throw new DomainError(
      "ASSET_MISMATCH",
      `This promise is in ${promise.assetCode} (scale ${promise.assetScale}) but the wallet uses ` +
        `${payer.assetCode} (scale ${payer.assetScale}). Use a ${promise.assetCode} wallet.`,
    );
  }

  const pending = await requestOutgoingGrant({
    payer,
    debitAmount: { value: promise.totalValue, assetCode: promise.assetCode, assetScale: promise.assetScale },
    finishUri: `${getEnv().appBaseUrl}/api/grants/callback/${promise.id}`,
  });

  inTransaction(() => {
    savePendingGrant(promise.id, payer.id, pending);
    insertEvent(promise.id, "authorization_started", { payerWallet: payer.id });
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
  if (promise.status !== "awaiting_approval") {
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
    transition("promise", promise.id, "awaiting_approval", "active", {
      type: "payer_approved",
      payload: { payerWallet: promise.payerWallet, hashVerified: hashOk },
    });
  });
  return { ...promise, status: "active" };
}

/** Callback without interact_ref: the payer declined. Status stays awaiting_approval. */
export function rejectAuthorization(promiseId: string): PromiseRecord {
  const promise = getPromiseOrThrow(promiseId);
  if (promise.status === "awaiting_approval") {
    insertEvent(promise.id, "payer_rejected", { payerWallet: promise.payerWallet });
  }
  return promise;
}
