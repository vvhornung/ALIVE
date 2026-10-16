import type { IncomingPayment, IncomingPaymentWithPaymentMethods } from "@interledger/open-payments";
import { getOpClient } from "./client";
import { wrapOp } from "./errors";
import type { ResolvedWallet } from "./wallet";

/** D2: open incoming payment (no incomingAmount) on the recipient's wallet. */
export async function createOpenIncomingPayment(args: {
  recipient: ResolvedWallet;
  accessToken: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}): Promise<IncomingPaymentWithPaymentMethods> {
  const client = await getOpClient();
  return wrapOp("incoming.create", () =>
    client.incomingPayment.create(
      { url: args.recipient.resourceServer, accessToken: args.accessToken },
      { walletAddress: args.recipient.id, metadata: args.metadata, expiresAt: args.expiresAt },
    ),
  );
}

export async function getIncomingPayment(args: {
  url: string;
  accessToken: string;
}): Promise<IncomingPaymentWithPaymentMethods> {
  const client = await getOpClient();
  return wrapOp("incoming.get", () => client.incomingPayment.get({ url: args.url, accessToken: args.accessToken }));
}

/** Needs the `complete` action on the incoming grant. */
export async function completeIncomingPayment(args: { url: string; accessToken: string }): Promise<IncomingPayment> {
  const client = await getOpClient();
  return wrapOp("incoming.complete", () =>
    client.incomingPayment.complete({ url: args.url, accessToken: args.accessToken }),
  );
}
