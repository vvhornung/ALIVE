import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isFinalizedGrantWithAccessToken, isPendingGrant } from "@interledger/open-payments";
import type { Amount } from "../money";
import { getOpClient } from "./client";
import { OpError, wrapOp } from "./errors";
import type { ResolvedWallet } from "./wallet";

/** Everything the server must persist between the redirect and the callback. */
export type PendingOutgoingGrant = {
  redirectUrl: string; // the only value that may go to the browser
  continueUri: string;
  continueToken: string;
  clientNonce: string; // ours, sent in interact.finish.nonce
  finishNonce: string; // interact.finish returned by the AS (hash input)
};

export type GrantToken = {
  accessToken: string;
  manageUri: string;
  expiresIn: number | undefined; // seconds
};

/**
 * D1: one interactive outgoing-payment grant per promise. Total debitAmount
 * limit in the payer's asset, no receiver and no interval, so it can cover
 * several payments to different recipients.
 */
export async function requestOutgoingGrant(args: {
  payer: ResolvedWallet;
  debitAmount: Amount;
  finishUri: string;
  clientNonce?: string;
}): Promise<PendingOutgoingGrant> {
  const client = await getOpClient();
  const clientNonce = args.clientNonce ?? randomBytes(24).toString("base64url");
  const grant = await wrapOp("grant.outgoing.request", () =>
    client.grant.request(
      { url: args.payer.authServer },
      {
        access_token: {
          access: [
            {
              type: "outgoing-payment",
              actions: ["create", "read", "list"],
              identifier: args.payer.id,
              limits: { debitAmount: args.debitAmount },
            },
          ],
        },
        interact: {
          start: ["redirect"],
          finish: { method: "redirect", uri: args.finishUri, nonce: clientNonce },
        },
      },
    ),
  );
  if (!isPendingGrant(grant)) {
    throw new OpError("grant.outgoing.request", "Expected an interactive (pending) grant");
  }
  return {
    redirectUrl: grant.interact.redirect,
    continueUri: grant.continue.uri,
    continueToken: grant.continue.access_token.value,
    clientNonce,
    finishNonce: grant.interact.finish,
  };
}

/** Called after the consent redirect with the single-use interact_ref. */
export async function continueGrant(args: {
  continueUri: string;
  continueToken: string;
  interactRef: string;
}): Promise<GrantToken> {
  const client = await getOpClient();
  const grant = await wrapOp("grant.continue", () =>
    client.grant.continue(
      { url: args.continueUri, accessToken: args.continueToken },
      { interact_ref: args.interactRef },
    ),
  );
  if (!isFinalizedGrantWithAccessToken(grant)) {
    throw new OpError("grant.continue", "Grant was not finalized with an access token");
  }
  return {
    accessToken: grant.access_token.value,
    manageUri: grant.access_token.manage,
    expiresIn: grant.access_token.expires_in,
  };
}

/** Non-interactive grant on the RECIPIENT's auth server. */
export async function requestIncomingGrant(recipient: ResolvedWallet): Promise<string> {
  const client = await getOpClient();
  const grant = await wrapOp("grant.incoming.request", () =>
    client.grant.request(
      { url: recipient.authServer },
      { access_token: { access: [{ type: "incoming-payment", actions: ["create", "read", "complete"] }] } },
    ),
  );
  if (!isFinalizedGrantWithAccessToken(grant)) {
    throw new OpError("grant.incoming.request", "Expected a finalized incoming-payment grant");
  }
  return grant.access_token.value;
}

/** D7: non-interactive quote grant on the PAYER's auth server; not stored. */
export async function requestQuoteGrant(payer: ResolvedWallet): Promise<string> {
  const client = await getOpClient();
  const grant = await wrapOp("grant.quote.request", () =>
    client.grant.request(
      { url: payer.authServer },
      { access_token: { access: [{ type: "quote", actions: ["create", "read"] }] } },
    ),
  );
  if (!isFinalizedGrantWithAccessToken(grant)) {
    throw new OpError("grant.quote.request", "Expected a finalized quote grant");
  }
  return grant.access_token.value;
}

/** D6: rotate right before executing. The old token stops working. */
export async function rotateToken(args: { manageUri: string; accessToken: string }): Promise<GrantToken> {
  const client = await getOpClient();
  const rotated = await wrapOp("token.rotate", () =>
    client.token.rotate({ url: args.manageUri, accessToken: args.accessToken }),
  );
  return {
    accessToken: rotated.access_token.value,
    manageUri: rotated.access_token.manage,
    expiresIn: rotated.access_token.expires_in,
  };
}

/**
 * D5: GNAP interaction hash =
 * base64(sha256(clientNonce \n finishNonce \n interact_ref \n authServer)).
 */
export function computeInteractHash(args: {
  clientNonce: string;
  finishNonce: string;
  interactRef: string;
  authServer: string;
}): string {
  return createHash("sha256")
    .update(`${args.clientNonce}\n${args.finishNonce}\n${args.interactRef}\n${args.authServer}`)
    .digest("base64");
}

export function verifyInteractHash(args: {
  clientNonce: string;
  finishNonce: string;
  interactRef: string;
  authServer: string;
  hash: string;
}): boolean {
  const expected = Buffer.from(computeInteractHash(args));
  const received = Buffer.from(args.hash);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
