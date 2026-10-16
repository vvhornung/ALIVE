import { randomBytes, timingSafeEqual } from "node:crypto";

/** 256-bit random URL-safe token (approval links, status pages). */
export const newPublicToken = (): string => randomBytes(32).toString("base64url");

/** Constant-time string comparison. */
export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
