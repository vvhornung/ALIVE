// AES-256-GCM for grant tokens/URIs at rest. Output is one base64 string:
// iv (12 bytes) ‖ auth tag (16 bytes) ‖ ciphertext. Tampering makes decrypt throw.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "./env";

const IV_BYTES = 12;
const TAG_BYTES = 16;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

function keyFromBase64(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new CryptoError("Encryption key must be 32 bytes");
  return key;
}

export function encrypt(plaintext: string, base64Key: string = getEnv().encryptionKey): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFromBase64(base64Key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decrypt(payload: string, base64Key: string = getEnv().encryptionKey): string {
  const data = Buffer.from(payload, "base64");
  if (data.length < IV_BYTES + TAG_BYTES) throw new CryptoError("Encrypted payload is too short");
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = data.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFromBase64(base64Key), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof CryptoError) throw error;
    throw new CryptoError("Could not decrypt: wrong key or tampered data");
  }
}

/** For nullable DB columns. */
export const encryptOptional = (value: string | null | undefined): string | null =>
  value == null ? null : encrypt(value);
export const decryptOptional = (value: string | null | undefined): string | null =>
  value == null ? null : decrypt(value);
