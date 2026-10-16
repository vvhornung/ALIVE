// SIMULATED revocation for the demo (AGENTS §8 revoke-sim). Clearly labeled as
// simulated in events and DTOs. Real revocations (detected when rotating the
// token) cannot be cleared here: the payer must approve again.
import { inTransaction, setAtRiskReason, type PromiseRecord } from "@/lib/db";
import { DomainError } from "./errors";
import { getPromiseOrThrow } from "./promises";
import { transition } from "./stateMachine";

export function setSimulatedRevocation(promiseId: string, revoked: boolean): PromiseRecord {
  const promise = getPromiseOrThrow(promiseId);
  const simulatedAtRisk = promise.status === "at_risk" && promise.atRiskReason === "simulated_revocation";

  if (revoked) {
    if (simulatedAtRisk) return promise; // idempotent
    if (promise.status !== "active") {
      throw new DomainError("INVALID_STATE", `Only an active promise can be put at risk (it is ${promise.status})`);
    }
    inTransaction(() => {
      transition("promise", promiseId, "active", "at_risk", {
        type: "revocation_simulated",
        payload: { simulated: true },
      });
      setAtRiskReason(promiseId, "simulated_revocation");
    });
  } else {
    if (promise.status === "active") return promise; // idempotent
    if (!simulatedAtRisk) {
      throw new DomainError(
        "INVALID_STATE",
        promise.status === "at_risk"
          ? "This is a real authorization problem, not a simulation: the payer must approve again"
          : `Promise is ${promise.status}; there is no simulated revocation to clear`,
      );
    }
    inTransaction(() => {
      transition("promise", promiseId, "at_risk", "active", {
        type: "revocation_cleared",
        payload: { simulated: true },
      });
      setAtRiskReason(promiseId, null);
    });
  }
  return getPromiseOrThrow(promiseId);
}
