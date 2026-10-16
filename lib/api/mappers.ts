// DB records → DTOs. Every field is copied explicitly (no spreads) so a new
// secret column can never leak into a response by accident.
import type { AllocationRecord, PromiseRecord } from "@/lib/db";
import { parseMinor, toDisplay, type Amount } from "@/lib/money";
import type { AllocationView, ApprovalView, MoneyView, PromiseView, PublicStatusView } from "./types";

export function toMoneyView(amount: Amount): MoneyView {
  return {
    value: amount.value,
    assetCode: amount.assetCode,
    assetScale: amount.assetScale,
    display: toDisplay(amount),
  };
}

function promiseAmount(promise: PromiseRecord, value: string): MoneyView {
  return toMoneyView({ value, assetCode: promise.assetCode, assetScale: promise.assetScale });
}

export function toAllocationView(
  promise: PromiseRecord,
  allocation: AllocationRecord,
  appBaseUrl: string,
): AllocationView {
  return {
    id: allocation.id,
    label: allocation.label,
    recipientWallet: allocation.recipientWallet,
    amount: promiseAmount(promise, allocation.value),
    status: allocation.status,
    simulated: allocation.simulated,
    statusUrl: `${appBaseUrl}/status/${allocation.statusToken}`,
  };
}

export function toPromiseView(
  promise: PromiseRecord,
  allocations: AllocationRecord[],
  appBaseUrl: string,
): PromiseView {
  const allocated = allocations.reduce((acc, a) => acc + parseMinor(a.value), 0n);
  const unallocated = parseMinor(promise.totalValue) - allocated;
  return {
    id: promise.id,
    status: promise.status,
    freelancer: { wallet: promise.freelancerWallet, name: promise.freelancerName },
    payerWallet: promise.payerWallet,
    amount: promiseAmount(promise, promise.totalValue),
    allocated: promiseAmount(promise, allocated.toString()),
    unallocated: promiseAmount(promise, (unallocated < 0n ? 0n : unallocated).toString()),
    dueAt: promise.dueAt,
    description: promise.description,
    invoiceRef: promise.invoiceRef,
    allocations: allocations.map((a) => toAllocationView(promise, a, appBaseUrl)),
    createdAt: promise.createdAt,
    testMode: true,
  };
}

export function toApprovalView(promise: PromiseRecord): ApprovalView {
  return {
    promiseId: promise.id,
    freelancerName: promise.freelancerName,
    amount: promiseAmount(promise, promise.totalValue),
    dueAt: promise.dueAt,
    description: promise.description,
    invoiceRef: promise.invoiceRef,
    status: promise.status,
    testMode: true,
  };
}

export function toPublicStatusView(promise: PromiseRecord, allocation: AllocationRecord): PublicStatusView {
  return {
    label: allocation.label,
    amount: promiseAmount(promise, allocation.value),
    status: allocation.status,
    simulated: allocation.simulated,
    freelancerName: promise.freelancerName,
    dueAt: promise.dueAt,
    testMode: true,
    note: "Status reported by ALIVE's server. Test mode: play money on the Interledger test wallet.",
  };
}

export const approvalUrlFor = (appBaseUrl: string, approvalToken: string): string =>
  `${appBaseUrl}/approve/${approvalToken}`;
