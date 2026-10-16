// Spike S0: one full payment payer → recipient A with lib/op (all 8 steps),
// using our D2 design (open incoming payment + fixed-debit quote).
// Run: npm run spike:s0   (needs .env.local and a browser approval)
import { getEnv } from "../lib/env";
import { fromDecimalString, toDisplay, type Amount } from "../lib/money";
import { continueGrant, requestIncomingGrant, requestOutgoingGrant, requestQuoteGrant } from "../lib/op/grants";
import { completeIncomingPayment, createOpenIncomingPayment } from "../lib/op/incoming";
import { createOutgoingPayment, pollOutgoing } from "../lib/op/outgoing";
import { createFixedDebitQuote, isQuoteExpired } from "../lib/op/quote";
import { resolveWallet } from "../lib/op/wallet";
import {
  approveInBrowser,
  CALLBACK_URL,
  describeWallet,
  info,
  printAttempt,
  printError,
  requireSpikeVar,
  step,
} from "./_shared";

const AMOUNT = "1.00";

async function main() {
  const env = getEnv();
  const payerUrl = requireSpikeVar("SPIKE_PAYER_WALLET");
  const recipientUrl = requireSpikeVar("SPIKE_RECIPIENT_A_WALLET");

  step("1. Resolver wallets");
  const payer = await resolveWallet(payerUrl);
  const recipient = await resolveWallet(recipientUrl);
  describeWallet("pagador", payer);
  describeWallet("receptor A", recipient);

  step("2. Grant de incoming payment (AS del receptor)");
  const incomingToken = await requestIncomingGrant(recipient);
  info("ok");

  step("3. Incoming payment abierto (sin incomingAmount)");
  const incoming = await createOpenIncomingPayment({
    recipient,
    accessToken: incomingToken,
    metadata: { spike: "s0", description: "ALIVE spike S0" },
  });
  info(`incoming: ${incoming.id}`);

  step("4. Grant de quote (AS del pagador)");
  let quoteToken = await requestQuoteGrant(payer);
  info("ok");

  const debitAmount: Amount = {
    value: fromDecimalString(AMOUNT, payer.assetScale),
    assetCode: payer.assetCode,
    assetScale: payer.assetScale,
  };
  step("5. Quote de débito fijo", toDisplay(debitAmount));
  let quote = await createFixedDebitQuote({
    payer,
    accessToken: quoteToken,
    incomingPaymentUrl: incoming.id,
    debitAmount,
  });
  info(`quote: ${quote.id}`);
  info(`debit ${toDisplay(quote.debitAmount)} → receive ${toDisplay(quote.receiveAmount)} (expira ${quote.expiresAt ?? "?"})`);

  step("6. Grant interactivo de outgoing payment", `límite debitAmount = ${toDisplay(quote.debitAmount)}`);
  const pending = await requestOutgoingGrant({ payer, debitAmount: quote.debitAmount, finishUri: CALLBACK_URL });
  info("grant pendiente creado");

  step("7. Aprobación del pagador");
  const { interactRef, hashMatches } = await approveInBrowser(pending, payer, env.strictHash);

  step("8. Continuar el grant");
  const grant = await continueGrant({
    continueUri: pending.continueUri,
    continueToken: pending.continueToken,
    interactRef,
  });
  info(`token obtenido (expires_in: ${grant.expiresIn ?? "?"} s)`);

  if (isQuoteExpired(quote)) {
    step("8b. La quote expiró mientras se aprobaba: re-cotizando");
    quoteToken = await requestQuoteGrant(payer);
    quote = await createFixedDebitQuote({ payer, accessToken: quoteToken, incomingPaymentUrl: incoming.id, debitAmount });
    info(`nueva quote: ${quote.id} | debit ${toDisplay(quote.debitAmount)} → receive ${toDisplay(quote.receiveAmount)}`);
  }

  step("9. Outgoing payment");
  const outgoing = await createOutgoingPayment({
    payer,
    accessToken: grant.accessToken,
    quoteId: quote.id,
    metadata: { spike: "s0" },
  });
  info(`outgoing: ${outgoing.id}`);

  step("10. Poll (regla D10: received >= quote.receiveAmount)");
  const result = await pollOutgoing({
    outgoingUrl: outgoing.id,
    outgoingToken: grant.accessToken,
    incomingUrl: incoming.id,
    incomingToken,
    quoteReceiveAmount: quote.receiveAmount,
    onAttempt: printAttempt,
  });

  step("11. Completar el incoming payment (best-effort)");
  try {
    const completed = await completeIncomingPayment({ url: incoming.id, accessToken: incomingToken });
    info(`completed=${completed.completed}`);
  } catch (error) {
    printError(error);
  }

  console.log("\n================ RESULTADO S0 ================");
  console.log(`S0: ${result.status === "completed" ? "PASS" : "FAIL"} (${result.status}, ${result.attempts} intentos)`);
  console.log(`hash coincide: ${hashMatches ? "sí" : "no"}`);
  console.log(`incoming: ${incoming.id}`);
  console.log(`quote:    ${quote.id}`);
  console.log(`outgoing: ${outgoing.id}`);
  console.log(
    `final: sent ${toDisplay(result.outgoing.sentAmount)} / debit ${toDisplay(result.outgoing.debitAmount)}` +
      ` | received ${toDisplay(result.incoming.receivedAmount)} / quote receive ${toDisplay(quote.receiveAmount)}`,
  );
  console.log("Copia este bloque en docs/spikes.md.");
  if (result.status !== "completed") process.exitCode = 1;
}

main().catch((e) => {
  printError(e);
  process.exit(1);
});
