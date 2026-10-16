// Shared helpers for the spike scripts. They print ids, statuses and amounts
// only: never tokens, keys or full SDK responses.
import { createServer } from "node:http";
import { OpenPaymentsClientError } from "@interledger/open-payments";
import { OpError, toOpError } from "../lib/op/errors";
import { verifyInteractHash, type PendingOutgoingGrant } from "../lib/op/grants";
import type { PollAttempt } from "../lib/op/outgoing";
import type { ResolvedWallet } from "../lib/op/wallet";
import { toDisplay } from "../lib/money";

export const CALLBACK_PORT = 3344;
export const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}/callback`;

export function requireSpikeVar(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Falta ${name} en .env.local (ver .env.example)`);
  }
  return value;
}

export function step(label: string, detail = ""): void {
  console.log(`\n▶ ${label}${detail ? `: ${detail}` : ""}`);
}

export function info(detail: string): void {
  console.log(`   ${detail}`);
}

export function describeWallet(role: string, wallet: ResolvedWallet): void {
  info(`${role}: ${wallet.id} (${wallet.assetCode}, scale ${wallet.assetScale})`);
}

export function printAttempt(a: PollAttempt): void {
  info(
    `poll #${a.attempt} → ${a.outcome} | sent ${toDisplay(a.sentAmount)} / debit ${toDisplay(a.debitAmount)}` +
      ` | quote receive ${toDisplay(a.receiveAmount)} / received ${toDisplay(a.receivedAmount)}`,
  );
}

/** SDK failures print as one safe line; anything else (bugs, env) prints in full. */
export function printError(error: unknown): void {
  if (error instanceof OpError || error instanceof OpenPaymentsClientError) {
    console.error(`   ✖ ${toOpError("unknown", error).toLogString()}`);
  } else {
    console.error(error);
  }
}

type CallbackResult = { interactRef: string | undefined; hash: string | undefined };

/** One-shot local HTTP server that receives the consent redirect. */
export function waitForCallback(timeoutMs = 10 * 60_000): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", CALLBACK_URL);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const interactRef = url.searchParams.get("interact_ref") ?? undefined;
      const hash = url.searchParams.get("hash") ?? undefined;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        interactRef
          ? "<h1>Aprobado. Vuelve a la terminal.</h1>"
          : "<h1>No se recibió interact_ref (rechazado). Vuelve a la terminal.</h1>",
      );
      clearTimeout(timer);
      server.close();
      resolve({ interactRef, hash });
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`No llegó el callback en ${timeoutMs / 60_000} min`));
    }, timeoutMs);
    server.on("error", reject);
    server.listen(CALLBACK_PORT);
  });
}

/**
 * Prints the consent URL, waits for the redirect and checks the hash (D5).
 * Returns the interact_ref and whether the hash matched.
 */
export async function approveInBrowser(
  pending: PendingOutgoingGrant,
  payer: ResolvedWallet,
  strictHash: boolean,
): Promise<{ interactRef: string; hashMatches: boolean }> {
  const callback = waitForCallback();
  console.log(`\n   Abre esta URL, inicia sesión con la wallet PAGADORA y aprueba:\n\n   ${pending.redirectUrl}\n`);
  info(`Esperando el callback en ${CALLBACK_URL} ...`);
  const { interactRef, hash } = await callback;
  if (!interactRef) {
    throw new OpError("callback", "El pagador rechazó o no llegó interact_ref");
  }
  const hashMatches =
    hash !== undefined &&
    verifyInteractHash({
      clientNonce: pending.clientNonce,
      finishNonce: pending.finishNonce,
      interactRef,
      authServer: payer.authServer,
      hash,
    });
  info(`hash: ${hash === undefined ? "NO VINO" : hashMatches ? "coincide ✔" : "NO coincide ✖"}`);
  if (!hashMatches && strictHash) {
    throw new OpError("callback", "Hash inválido y STRICT_HASH=true");
  }
  return { interactRef, hashMatches };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
