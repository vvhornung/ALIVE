import type { Quote } from "@interledger/open-payments";
import type { Amount } from "../money";
import { getOpClient } from "./client";
import { wrapOp } from "./errors";
import type { ResolvedWallet } from "./wallet";

/**
 * D2: fixed-debit quote on the payer's wallet. The payer is debited exactly
 * `debitAmount`; fees and FX come out of the receive side.
 */
export async function createFixedDebitQuote(args: {
  payer: ResolvedWallet;
  accessToken: string;
  incomingPaymentUrl: string;
  debitAmount: Amount;
}): Promise<Quote> {
  const client = await getOpClient();
  return wrapOp("quote.create", () =>
    client.quote.create(
      { url: args.payer.resourceServer, accessToken: args.accessToken },
      {
        walletAddress: args.payer.id,
        receiver: args.incomingPaymentUrl,
        method: "ilp",
        debitAmount: args.debitAmount,
      },
    ),
  );
}

export async function getQuote(args: { url: string; accessToken: string }): Promise<Quote> {
  const client = await getOpClient();
  return wrapOp("quote.get", () => client.quote.get({ url: args.url, accessToken: args.accessToken }));
}

export function isQuoteExpired(quote: Quote, now: Date = new Date()): boolean {
  return quote.expiresAt !== undefined && new Date(quote.expiresAt).getTime() <= now.getTime();
}
