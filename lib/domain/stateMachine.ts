// Explicit transition tables (AGENTS §9). Statuses change ONLY through
// transition(), which appends an events row in the same DB transaction.
// Payment transitions are defined in the payout prompt (D9 step semantics).
import {
  compareAndSetStatus,
  getOwningPromiseId,
  getStatus,
  inTransaction,
  insertEvent,
  type AllocationStatus,
  type PromiseStatus,
} from "@/lib/db";
import { DomainError } from "./errors";

export const PROMISE_TRANSITIONS: Readonly<Record<PromiseStatus, readonly PromiseStatus[]>> = {
  draft: ["awaiting_approval"],
  awaiting_approval: ["active", "expired"],
  active: ["executing", "at_risk", "expired"],
  executing: ["completed", "partially_failed", "at_risk"],
  completed: [],
  partially_failed: [],
  at_risk: [],
  expired: [],
};

export const ALLOCATION_TRANSITIONS: Readonly<Record<AllocationStatus, readonly AllocationStatus[]>> = {
  pending: ["paying"],
  paying: ["paid", "failed"],
  paid: [],
  failed: [],
};

type Machine = {
  promise: { status: PromiseStatus };
  allocation: { status: AllocationStatus };
};

const TABLES: { [E in keyof Machine]: Readonly<Record<Machine[E]["status"], readonly Machine[E]["status"][]>> } = {
  promise: PROMISE_TRANSITIONS,
  allocation: ALLOCATION_TRANSITIONS,
};

export function canTransition<E extends keyof Machine>(
  entity: E,
  from: Machine[E]["status"],
  to: Machine[E]["status"],
): boolean {
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
  from: Machine[E]["status"],
  to: Machine[E]["status"],
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
      from,
      to,
    });
  });
}
