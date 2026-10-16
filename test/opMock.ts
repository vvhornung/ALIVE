// Shared fakes for tests that mock "@/lib/op". Nothing here touches the network.
import type { ResolvedWallet } from "@/lib/op/wallet";

export function wallet(name: string, assetCode = "USD", assetScale = 2): ResolvedWallet {
  return {
    id: `https://ilp.interledger-test.dev/${name}`,
    publicName: name === "anon" ? undefined : `${name[0].toUpperCase()}${name.slice(1)}`,
    assetCode,
    assetScale,
    authServer: "https://auth.interledger-test.dev/tenant",
    resourceServer: "https://ilp.interledger-test.dev/tenant",
  };
}

/** Resolves any URL to a wallet named after its last path segment. */
export function resolveByName(overrides: Record<string, ResolvedWallet> = {}) {
  return async (url: string): Promise<ResolvedWallet> => {
    const name = url.replace(/^\$/, "https://").split("/").pop() ?? "x";
    return overrides[name] ?? wallet(name);
  };
}

export const PENDING_GRANT = {
  redirectUrl: "https://auth.interledger-test.dev/interact/abc",
  continueUri: "https://auth.interledger-test.dev/continue/abc",
  continueToken: "SECRET-continue-token",
  clientNonce: "SECRET-client-nonce",
  finishNonce: "SECRET-finish-nonce",
};

export const ACTIVE_GRANT = {
  accessToken: "SECRET-access-token",
  manageUri: "https://auth.interledger-test.dev/token/SECRET-manage",
  expiresIn: 600,
};

/** Strings that must never appear in any API response. */
export const SECRET_MARKERS = ["SECRET-"];
