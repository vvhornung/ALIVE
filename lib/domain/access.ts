// Freelancer key check. Missing or wrong key → NOT_FOUND, so a caller without
// the key cannot even confirm that a promise id exists.
import { getFreelancerKeyHash, type PromiseRecord } from "@/lib/db";
import { DomainError } from "./errors";
import { getPromiseOrThrow } from "./promises";
import { secretMatchesHash } from "./tokens";

export const FREELANCER_KEY_HEADER = "x-freelancer-key";

export function assertFreelancerKey(promiseId: string, presentedKey: string | null | undefined): PromiseRecord {
  const hash = getFreelancerKeyHash(promiseId);
  if (!hash || !presentedKey || !secretMatchesHash(presentedKey, hash)) {
    throw new DomainError("NOT_FOUND", "Promise not found");
  }
  return getPromiseOrThrow(promiseId);
}
