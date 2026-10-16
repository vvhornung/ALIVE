import type {
  IncomingPayment,
  OutgoingPayment,
  OutgoingPaymentGrantSpentAmounts,
  OutgoingPaymentWithSpentAmounts,
} from "@interledger/open-payments";
import { parseMinor, type Amount } from "../money";
import { getOpClient } from "./client";
import { wrapOp } from "./errors";
import { getIncomingPayment } from "./incoming";
import type { ResolvedWallet } from "./wallet";

export async function createOutgoingPayment(args: {
  payer: ResolvedWallet;
  accessToken: string;
  quoteId: string;
  metadata?: Record<string, unknown>;
}): Promise<OutgoingPaymentWithSpentAmounts> {
  const client = await getOpClient();
  return wrapOp("outgoing.create", () =>
    client.outgoingPayment.create(
      { url: args.payer.resourceServer, accessToken: args.accessToken },
      { walletAddress: args.payer.id, quoteId: args.quoteId, metadata: args.metadata },
    ),
  );
}

export async function getOutgoingPayment(args: { url: string; accessToken: string }): Promise<OutgoingPayment> {
  const client = await getOpClient();
  return wrapOp("outgoing.get", () => client.outgoingPayment.get({ url: args.url, accessToken: args.accessToken }));
}

/** How much of the outgoing grant's limit has been used so far. */
export async function getGrantSpentAmounts(args: {
  payer: ResolvedWallet;
  accessToken: string;
}): Promise<OutgoingPaymentGrantSpentAmounts> {
  const client = await getOpClient();
  return wrapOp("outgoing.grantSpent", () =>
    client.outgoingPayment.getGrantSpentAmounts({ url: args.payer.resourceServer, accessToken: args.accessToken }),
  );
}

export type PaymentOutcome = "completed" | "failed" | "pending";

/**
 * D10 completion rule (pending confirmation in spike S0):
 * completed when the incoming payment has received at least the quote's
 * receiveAmount; failed when the outgoing payment reports failed.
 */
export function classifyPayment(
  outgoing: Pick<OutgoingPayment, "failed">,
  incoming: Pick<IncomingPayment, "receivedAmount">,
  quoteReceiveAmount: Amount,
): PaymentOutcome {
  if (parseMinor(incoming.receivedAmount.value) >= parseMinor(quoteReceiveAmount.value)) return "completed";
  if (outgoing.failed) return "failed";
  return "pending";
}

export type PollAttempt = {
  attempt: number;
  outcome: PaymentOutcome;
  sentAmount: Amount;
  debitAmount: Amount;
  receiveAmount: Amount;
  receivedAmount: Amount;
};

export type PollResult = {
  status: "completed" | "failed" | "timeout";
  attempts: number;
  outgoing: OutgoingPayment;
  incoming: IncomingPayment;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** D10: reads both resources every `intervalMs` until completed, failed or timeout. */
export async function pollOutgoing(args: {
  outgoingUrl: string;
  outgoingToken: string;
  incomingUrl: string;
  incomingToken: string;
  quoteReceiveAmount: Amount;
  intervalMs?: number;
  timeoutMs?: number;
  onAttempt?: (attempt: PollAttempt) => void;
}): Promise<PollResult> {
  const intervalMs = args.intervalMs ?? 1500;
  const deadline = Date.now() + (args.timeoutMs ?? 30_000);
  for (let attempt = 1; ; attempt++) {
    const [outgoing, incoming] = await Promise.all([
      getOutgoingPayment({ url: args.outgoingUrl, accessToken: args.outgoingToken }),
      getIncomingPayment({ url: args.incomingUrl, accessToken: args.incomingToken }),
    ]);
    const outcome = classifyPayment(outgoing, incoming, args.quoteReceiveAmount);
    args.onAttempt?.({
      attempt,
      outcome,
      sentAmount: outgoing.sentAmount,
      debitAmount: outgoing.debitAmount,
      receiveAmount: outgoing.receiveAmount,
      receivedAmount: incoming.receivedAmount,
    });
    if (outcome !== "pending") return { status: outcome, attempts: attempt, outgoing, incoming };
    if (Date.now() + intervalMs > deadline) return { status: "timeout", attempts: attempt, outgoing, incoming };
    await sleep(intervalMs);
  }
}
