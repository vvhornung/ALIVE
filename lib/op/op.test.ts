import { createHash } from "node:crypto";
import { OpenPaymentsClientError } from "@interledger/open-payments";
import { describe, expect, it } from "vitest";
import { OpError, toOpError } from "./errors";
import { computeInteractHash, verifyInteractHash } from "./grants";
import { classifyPayment } from "./outgoing";
import { normalizeWalletUrl } from "./wallet";

const amount = (value: string) => ({ value, assetCode: "USD", assetScale: 2 });

describe("normalizeWalletUrl", () => {
  it("converts payment pointers and keeps https URLs", () => {
    expect(normalizeWalletUrl("$ilp.interledger-test.dev/alice")).toBe("https://ilp.interledger-test.dev/alice");
    expect(normalizeWalletUrl(" https://ilp.interledger-test.dev/alice ")).toBe("https://ilp.interledger-test.dev/alice");
  });

  it("rejects http and garbage", () => {
    expect(() => normalizeWalletUrl("http://ilp.interledger-test.dev/alice")).toThrow(OpError);
    expect(() => normalizeWalletUrl("alice")).toThrow(OpError);
  });
});

describe("interact hash", () => {
  const input = {
    clientNonce: "client-nonce",
    finishNonce: "finish-nonce",
    interactRef: "ref-123",
    authServer: "https://auth.interledger-test.dev/tenant",
  };
  const expected = createHash("sha256")
    .update("client-nonce\nfinish-nonce\nref-123\nhttps://auth.interledger-test.dev/tenant")
    .digest("base64");

  it("matches the GNAP formula", () => {
    expect(computeInteractHash(input)).toBe(expected);
    expect(verifyInteractHash({ ...input, hash: expected })).toBe(true);
  });

  it("rejects a wrong hash", () => {
    expect(verifyInteractHash({ ...input, hash: "nope" })).toBe(false);
    expect(verifyInteractHash({ ...input, interactRef: "other", hash: expected })).toBe(false);
  });
});

describe("classifyPayment (D10)", () => {
  it("is completed when received >= quote receiveAmount", () => {
    expect(classifyPayment({ failed: false }, { receivedAmount: amount("98") }, amount("98"))).toBe("completed");
    expect(classifyPayment({ failed: false }, { receivedAmount: amount("99") }, amount("98"))).toBe("completed");
  });

  it("is failed when the outgoing payment failed", () => {
    expect(classifyPayment({ failed: true }, { receivedAmount: amount("0") }, amount("98"))).toBe("failed");
  });

  it("is pending otherwise", () => {
    expect(classifyPayment({ failed: false }, { receivedAmount: amount("50") }, amount("98"))).toBe("pending");
  });
});

describe("toOpError", () => {
  it("keeps the SDK error details", () => {
    const sdkError = new OpenPaymentsClientError("Error making request", {
      description: "Insufficient grant",
      status: 403,
      code: "insufficient_grant",
      validationErrors: ["x"],
    });
    const error = toOpError("outgoing.create", sdkError);
    expect(error).toMatchObject({ step: "outgoing.create", status: 403, code: "insufficient_grant" });
    expect(error.toLogString()).toContain("status=403");
  });
});
