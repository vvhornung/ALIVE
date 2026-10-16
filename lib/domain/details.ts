// Read models for the routes (no SQL in app/).
import {
  getAllocationByStatusToken,
  getLatestPayment,
  getPromiseById,
  listAllocations,
  listEvents,
  listPaymentsForPromise,
  type AllocationRecord,
  type EventRecord,
  type PaymentRecord,
  type PromiseRecord,
} from "@/lib/db";
import { DomainError } from "./errors";
import { getPromiseOrThrow } from "./promises";

export type PromiseDetails = {
  promise: PromiseRecord;
  allocations: AllocationRecord[];
  payments: PaymentRecord[];
};

export function getPromiseDetails(promiseId: string): PromiseDetails {
  return {
    promise: getPromiseOrThrow(promiseId),
    allocations: listAllocations(promiseId),
    payments: listPaymentsForPromise(promiseId),
  };
}

export function getPromiseHistory(promiseId: string): PromiseDetails & { events: EventRecord[] } {
  return { ...getPromiseDetails(promiseId), events: listEvents(promiseId) };
}

/** Public status page: one allocation, its promise and latest payment, by unguessable token. */
export function getPublicStatus(statusToken: string): {
  promise: PromiseRecord;
  allocation: AllocationRecord;
  payment: PaymentRecord | undefined;
} {
  const allocation = getAllocationByStatusToken(statusToken);
  const promise = allocation && getPromiseById(allocation.promiseId);
  if (!allocation || !promise) throw new DomainError("NOT_FOUND", "Status link not found");
  return { promise, allocation, payment: getLatestPayment(allocation.id) };
}
