// Singleton authenticated Open Payments client (ARCHITECTURE-BACKEND D11, D12).
// Cached on globalThis so Next.js hot reload does not create a new client per edit.
import { createAuthenticatedClient, type AuthenticatedClient } from "@interledger/open-payments";
import { getEnv } from "../env";
import { wrapOp } from "./errors";

const globalForOp = globalThis as typeof globalThis & {
  __aliveOpClient?: Promise<AuthenticatedClient>;
};

export function getOpClient(): Promise<AuthenticatedClient> {
  if (!globalForOp.__aliveOpClient) {
    const env = getEnv();
    globalForOp.__aliveOpClient = wrapOp("client.create", () =>
      createAuthenticatedClient({
        walletAddressUrl: env.opWalletAddressUrl,
        // File path (resolved from cwd) or PEM text; OP_PRIVATE_KEY_B64 is decoded in env.ts.
        privateKey: env.opPrivateKey,
        keyId: env.opKeyId,
        // Debug logs would include request details; keep the SDK quiet.
        logLevel: "warn",
      }),
    ).catch((error: unknown) => {
      globalForOp.__aliveOpClient = undefined; // allow a retry after fixing config
      throw error;
    });
  }
  return globalForOp.__aliveOpClient;
}
