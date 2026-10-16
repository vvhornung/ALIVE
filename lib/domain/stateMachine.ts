// Explicit transition tables (AGENTS §9, ARCHITECTURE D9). Statuses change ONLY
// through transition(), which appends an events row in the same DB transaction.
import {
  compareAndSetStatus,
  getOwningPromiseId,
  getStatus,
  inTransaction,
  insertEvent,
  type AllocationStatus,
  type PaymentStep,
  type PromiseStatus,
} from "@/lib/db";
import { DomainError } from "./errors";

export const PROMISE_TRANSITIONS: Readonly<Record<PromiseStatus, readonly PromiseStatus[]>> = {
  draft: ["awaiting_approval"],
  awaiting_approval: ["active", "expired"],
  active: ["executing", "at_risk", "expired"],
  executing: ["completed", "partially_failed", "at_risk"],
  completed: [],
  partially_failed: ["executing"], // retry
  at_risk: ["active"], // revoke-sim cleared, or payer re-approved
  expired: [],
};

export const ALLOCATION_TRANSITIONS: Readonly<Record<AllocationStatus, readonly AllocationStatus[]>> = {
  pending: ["paying"],
  paying: ["paid", "failed"],
  paid: [],
  failed: ["paying"], // retry
};

/** D9: one row per attempt; a retry is a NEW payment row, never a step back. */
export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStep, readonly PaymentStep[]>> = {
  created: ["incoming_created", "failed"],
  incoming_created: ["quoted", "failed"],
  quoted: ["submitted", "failed"],
  submitted: ["completed", "failed"],
  completed: [],
  failed: [],
};

type Machine = {
  promise: PromiseStatus;
  allocation: AllocationStatus;
  payment: PaymentStep;
};

const TABLES: { [E in keyof Machine]: Readonly<Record<Machine[E], readonly Machine[E][]>> } = {
  promise: PROMISE_TRANSITIONS,
  allocation: ALLOCATION_TRANSITIONS,
  payment: PAYMENT_TRANSITIONS,
};

export function canTransition<E extends keyof Machine>(entity: E, from: Machine[E], to: Machine[E]): boolean {
  const table = TABLES[entity] as Readonly<Record<string, readonly string[]>>;
  return table[from]?.includes(to) ?? false;
}

/**
 * Moves `entity` from `from` to `to` and records an event, atomically.
 * Throws INVALID_STATE if the move is illegal or the current status is not `from`
 * (compare-and-set, so it doubles as the D8 lock).
 */
export function transition<E extends keyof Machine>(
  entity: E,
  id: string,
  from: Machine[E],
  to: Machine[E],
  event: { type: string; payload?: Record<string, unknown> },
): void {
  if (!canTransition(entity, from, to)) {
    throw new DomainError("INVALID_STATE", `Illegal ${entity} transition ${from} → ${to}`);
  }
  inTransaction(() => {
    if (!compareAndSetStatus(entity, id, from, to)) {
      const current = getStatus(entity, id);
      if (current === undefined) throw new DomainError("NOT_FOUND", `${entity} ${id} not found`);
      throw new DomainError("INVALID_STATE", `${entity} is ${current}, expected ${from}`);
    }
    const promiseId = getOwningPromiseId(entity, id);
    if (promiseId === undefined) throw new DomainError("NOT_FOUND", `${entity} ${id} not found`);
    insertEvent(promiseId, event.type, {
      ...event.payload,
      ...(entity === "allocation" ? { allocationId: id } : {}),
      ...(entity === "payment" ? { paymentId: id } : {}),
      from,
      to,
    });
  });
}
