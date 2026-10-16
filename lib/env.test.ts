import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";

const base = {
  OP_WALLET_ADDRESS_URL: "https://ilp.interledger-test.dev/alive",
  OP_KEY_ID: "key-id",
  OP_PRIVATE_KEY: "./private.key",
};

function errorOf(source: Record<string, string | undefined>): string {
  try {
    parseEnv(source);
  } catch (e) {
    expect(e).toBeInstanceOf(EnvError);
    return (e as EnvError).message;
  }
  throw new Error("expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("parses a minimal valid env with defaults", () => {
    const env = parseEnv(base);
    expect(env.opPrivateKey).toBe("./private.key");
    expect(env.appBaseUrl).toBe("http://localhost:3000");
    expect(env.strictHash).toBe(false);
    expect(env.encryptionKey).toBeUndefined();
  });

  it("normalizes a $ payment pointer to https://", () => {
    const env = parseEnv({ ...base, OP_WALLET_ADDRESS_URL: "$ilp.interledger-test.dev/alive" });
    expect(env.opWalletAddressUrl).toBe("https://ilp.interledger-test.dev/alive");
  });

  it("names every missing variable, treating empty strings as unset", () => {
    const message = errorOf({ OP_WALLET_ADDRESS_URL: "", OP_KEY_ID: "", OP_PRIVATE_KEY: "" });
    expect(message).toContain("OP_WALLET_ADDRESS_URL");
    expect(message).toContain("OP_KEY_ID");
    expect(message).toContain("OP_PRIVATE_KEY_B64");
  });

  it("decodes OP_PRIVATE_KEY_B64 and prefers it", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n";
    const env = parseEnv({ ...base, OP_PRIVATE_KEY: "", OP_PRIVATE_KEY_B64: Buffer.from(pem).toString("base64") });
    expect(env.opPrivateKey).toBe(pem);
  });

  it("rejects an http wallet address", () => {
    expect(errorOf({ ...base, OP_WALLET_ADDRESS_URL: "http://ilp.interledger-test.dev/alive" })).toContain(
      "OP_WALLET_ADDRESS_URL",
    );
  });

  it("validates ENCRYPTION_KEY length when set", () => {
    expect(errorOf({ ...base, ENCRYPTION_KEY: "c2hvcnQ=" })).toContain("ENCRYPTION_KEY");
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(parseEnv({ ...base, ENCRYPTION_KEY: key }).encryptionKey).toBe(key);
  });

  it("parses STRICT_HASH", () => {
    expect(parseEnv({ ...base, STRICT_HASH: "true" }).strictHash).toBe(true);
    expect(errorOf({ ...base, STRICT_HASH: "yes" })).toContain("STRICT_HASH");
  });

  it("strips a trailing slash from APP_BASE_URL", () => {
    expect(parseEnv({ ...base, APP_BASE_URL: "https://alive.example/" }).appBaseUrl).toBe("https://alive.example");
  });
});
