import { describe, expect, it } from "vitest";
import { CryptoError, decrypt, encrypt } from "./crypto";

const key = Buffer.alloc(32, 9).toString("base64");
const otherKey = Buffer.alloc(32, 8).toString("base64");

describe("crypto", () => {
  it("round-trips", () => {
    const secret = "access-token-value/with ✓ unicode";
    expect(decrypt(encrypt(secret, key), key)).toBe(secret);
  });

  it("uses a random IV (same input, different output)", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("does not contain the plaintext", () => {
    const payload = encrypt("super-secret-token", key);
    expect(Buffer.from(payload, "base64").toString("utf8")).not.toContain("super-secret-token");
  });

  it("detects tampering", () => {
    const data = Buffer.from(encrypt("token", key), "base64");
    data[data.length - 1] ^= 0x01;
    expect(() => decrypt(data.toString("base64"), key)).toThrow(CryptoError);
  });

  it("detects a tampered auth tag", () => {
    const data = Buffer.from(encrypt("token", key), "base64");
    data[12] ^= 0x01;
    expect(() => decrypt(data.toString("base64"), key)).toThrow(CryptoError);
  });

  it("rejects the wrong key", () => {
    expect(() => decrypt(encrypt("token", key), otherKey)).toThrow(CryptoError);
  });

  it("rejects short payloads and bad keys", () => {
    expect(() => decrypt("AAAA", key)).toThrow(CryptoError);
    expect(() => encrypt("x", Buffer.alloc(16).toString("base64"))).toThrow(CryptoError);
  });
});
