// Allocations divide a promise in OUR database (a grant cannot be split).
// Invariant: SUM(allocations.value) <= promises.total_value, checked with BigInt.
import { randomUUID } from "node:crypto";
import {
  getPromiseById,
  getStatus,
  inTransaction,
  insertEvent,
  listAllocations,
  replaceAllocationRows,
  type AllocationRecord,
  type PromiseStatus,
} from "@/lib/db";
import { fromDecimalString, MoneyError, parseMinor } from "@/lib/money";
import { resolveWallet } from "@/lib/op";
import { DomainError } from "./errors";
import { getPromiseOrThrow } from "./promises";
import { newPublicToken } from "./tokens";

export type AllocationInput = {
  label: string;
  recipientWallet: string;
  amount: string; // decimal string in the promise's asset
  simulated?: boolean;
};

/** Allocations can change until payment day starts. */
const EDITABLE: readonly PromiseStatus[] = ["draft", "awaiting_approval", "active"];

function assertEditable(status: string | undefined): void {
  if (!EDITABLE.includes(status as PromiseStatus)) {
    throw new DomainError("INVALID_STATE", `Allocations cannot change while the promise is ${status}`);
  }
}

export async function replaceAllocations(promiseId: string, items: AllocationInput[]): Promise<AllocationRecord[]> {
  const promise = getPromiseOrThrow(promiseId);
  assertEditable(promise.status);

  // Validate everything locally before any network call.
  const parsed = items.map((item, index) => {
    const label = item.label.trim();
    if (!label) throw new DomainError("VALIDATION_ERROR", `Allocation ${index + 1}: label is required`);
    let value: string;
    try {
      value = fromDecimalString(item.amount, promise.assetScale);
    } catch (error) {
      if (error instanceof MoneyError) {
        throw new DomainError("VALIDATION_ERROR", `Allocation ${index + 1} (${label}): ${error.message}`);
      }
      throw error;
    }
    if (parseMinor(value) <= 0n) {
      throw new DomainError("VALIDATION_ERROR", `Allocation ${index + 1} (${label}): amount must be greater than 0`);
    }
    return { label, value, recipientWallet: item.recipientWallet, simulated: item.simulated ?? false };
  });

  const total = parseMinor(promise.totalValue);
  const allocated = parsed.reduce((acc, item) => acc + parseMinor(item.value), 0n);
  if (allocated > total) {
    throw new DomainError(
      "ALLOCATION_EXCEEDS_TOTAL",
      `Allocations add up to ${allocated} but the promise total is ${total} (minor units, ${promise.assetCode})`,
    );
  }

  const rows: AllocationRecord[] = [];
  for (const item of parsed) {
    const recipient = await resolveWallet(item.recipientWallet);
    rows.push({
      id: randomUUID(),
      promiseId: promise.id,
      label: item.label,
      recipientWallet: recipient.id,
      value: item.value,
      status: "pending",
      statusToken: newPublicToken(),
      simulated: item.simulated,
    });
  }

  inTransaction(() => {
    assertEditable(getStatus("promise", promise.id)); // may have changed during the wallet lookups
    replaceAllocationRows(promise.id, rows);
    insertEvent(promise.id, "allocations_replaced", {
      count: rows.length,
      allocatedValue: allocated.toString(),
      labels: rows.map((r) => r.label),
    });
  });
  return listAllocations(promise.id);
}

export function getAllocations(promiseId: string): AllocationRecord[] {
  if (!getPromiseById(promiseId)) throw new DomainError("NOT_FOUND", "Promise not found");
  return listAllocations(promiseId);
}
