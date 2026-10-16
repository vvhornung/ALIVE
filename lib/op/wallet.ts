import { getOpClient } from "./client";
import { OpError, wrapOp } from "./errors";

export type ResolvedWallet = {
  id: string;
  publicName: string | undefined;
  assetCode: string;
  assetScale: number;
  authServer: string;
  resourceServer: string;
};

/** Accepts `$host/path` payment pointers or https URLs; returns an https URL. */
export function normalizeWalletUrl(input: string): string {
  const trimmed = input.trim();
  const url = trimmed.startsWith("$") ? `https://${trimmed.slice(1)}` : trimmed;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OpError("wallet.normalize", `Not a wallet address: "${input}"`);
  }
  if (parsed.protocol !== "https:") {
    throw new OpError("wallet.normalize", `Wallet address must use https://: "${input}"`);
  }
  return parsed.toString().replace(/\/$/, "");
}

/** GETs the wallet address; authServer/resourceServer always come from here, never hardcoded. */
export async function resolveWallet(url: string): Promise<ResolvedWallet> {
  const client = await getOpClient();
  const wallet = await wrapOp("wallet.get", () => client.walletAddress.get({ url: normalizeWalletUrl(url) }));
  return {
    id: wallet.id,
    publicName: wallet.publicName,
    assetCode: wallet.assetCode,
    assetScale: wallet.assetScale,
    authServer: wallet.authServer,
    resourceServer: wallet.resourceServer,
  };
}
