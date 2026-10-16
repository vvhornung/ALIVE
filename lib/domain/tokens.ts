import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 256-bit random URL-safe token (approval links, status pages). */
export const newPublicToken = (): string => randomBytes(32).toString("base64url");

/** Constant-time string comparison. */
export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** sha256 hex; only this is stored for the freelancer key. */
export const hashSecret = (secret: string): string => createHash("sha256").update(secret).digest("hex");

/** Constant-time check of a presented secret against its stored sha256. */
export const secretMatchesHash = (secret: string, hash: string): boolean => tokensEqual(hashSecret(secret), hash);
