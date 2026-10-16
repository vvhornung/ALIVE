// Spikes S1 + S2 + S5: one interactive outgoing grant (D1: total debitAmount
// limit 3.00, no receiver, no interval), token rotation after ~15 s, then two
// fixed-debit payments to two recipients under that grant, and a third 0.50
// payment that must be rejected for exceeding the limit.
// Run: npm run spike:s2   (needs .env.local and a browser approval)
import { getEnv } from "../lib/env";
import { fromDecimalString, toDisplay, type Amount } from "../lib/money";
import { toOpError } from "../lib/op/errors";
import {
  continueGrant,
  requestIncomingGrant,
  requestOutgoingGrant,
  requestQuoteGrant,
  rotateToken,
} from "../lib/op/grants";
import { completeIncomingPayment, createOpenIncomingPayment } from "../lib/op/incoming";
import { createOutgoingPayment, getGrantSpentAmounts, pollOutgoing } from "../lib/op/outgoing";
import { createFixedDebitQuote } from "../lib/op/quote";
import { resolveWallet, type ResolvedWallet } from "../lib/op/wallet";
import {
  approveInBrowser,
  CALLBACK_URL,
  describeWallet,
  info,
  printAttempt,
  printError,
  requireSpikeVar,
  sleep,
  step,
} from "./_shared";

const GRANT_LIMIT = "3.00";
const ROTATE_AFTER_MS = 15_000;

type PaymentReport = {
  label: string;
  status: "completed" | "failed" | "timeout" | "rejected";
  incomingId?: string;
  quoteId?: string;
  outgoingId?: string;
  detail: string;
};

async function main() {
  const env = getEnv();
  const payer = await resolveWallet(requireSpikeVar("SPIKE_PAYER_WALLET"));
  const recipientA = await resolveWallet(requireSpikeVar("SPIKE_RECIPIENT_A_WALLET"));
  const recipientB = await resolveWallet(requireSpikeVar("SPIKE_RECIPIENT_B_WALLET"));
  step("Wallets");
  describeWallet("pagador", payer);
  describeWallet("receptor A", recipientA);
  describeWallet("receptor B", recipientB);

  const inPayerAsset = (decimal: string): Amount => ({
    value: fromDecimalString(decimal, payer.assetScale),
    assetCode: payer.assetCode,
    assetScale: payer.assetScale,
  });

  // ---- S1: grant with generic limits, before any quote exists ----
  const limit = inPayerAsset(GRANT_LIMIT);
  step("S1. Grant interactivo SIN receiver ni interval", `límite debitAmount = ${toDisplay(limit)}`);
  const pending = await requestOutgoingGrant({ payer, debitAmount: limit, finishUri: CALLBACK_URL });
  const { interactRef, hashMatches } = await approveInBrowser(pending, payer, env.strictHash);
  const original = await continueGrant({
    continueUri: pending.continueUri,
    continueToken: pending.continueToken,
    interactRef,
  });
  info(`grant aprobado; token expires_in: ${original.expiresIn ?? "?"} s`);

  // ---- S5: rotate after a delay ----
  step("S5. Rotación del token", `esperando ${ROTATE_AFTER_MS / 1000} s`);
  await sleep(ROTATE_AFTER_MS);
  let s5 = "FAIL";
  let token = original;
  try {
    token = await rotateToken({ manageUri: original.manageUri, accessToken: original.accessToken });
    s5 = "PASS";
    info(`rotado ✔ nuevo expires_in: ${token.expiresIn ?? "?"} s; manage URI cambió: ${token.manageUri !== original.manageUri ? "sí" : "no"}`);
  } catch (error) {
    printError(error);
    info("se sigue con el token original");
  }
  if (s5 === "PASS") {
    try {
      await getGrantSpentAmounts({ payer, accessToken: original.accessToken });
      info("el token VIEJO todavía funciona (anotar)");
    } catch (error) {
      info(`token viejo rechazado como se esperaba (${toOpError("old-token", error).status ?? "?"})`);
    }
  }

  // ---- S2: several payments under the same grant ----
  step("Grant de quote (AS del pagador)");
  const quoteToken = await requestQuoteGrant(payer);

  async function pay(label: string, recipient: ResolvedWallet, decimal: string): Promise<PaymentReport> {
    const debitAmount = inPayerAsset(decimal);
    step(`Pago ${label}`, `${toDisplay(debitAmount)} → ${recipient.id}`);
    const report: PaymentReport = { label, status: "rejected", detail: "" };
    try {
      const incomingToken = await requestIncomingGrant(recipient);
      const incoming = await createOpenIncomingPayment({
        recipient,
        accessToken: incomingToken,
        metadata: { spike: "s2", label },
      });
      report.incomingId = incoming.id;
      info(`incoming: ${incoming.id}`);

      const quote = await createFixedDebitQuote({
        payer,
        accessToken: quoteToken,
        incomingPaymentUrl: incoming.id,
        debitAmount,
      });
      report.quoteId = quote.id;
      info(`quote: ${quote.id} | debit ${toDisplay(quote.debitAmount)} → receive ${toDisplay(quote.receiveAmount)}`);

      const outgoing = await createOutgoingPayment({
        payer,
        accessToken: token.accessToken,
        quoteId: quote.id,
        metadata: { spike: "s2", label },
      });
      report.outgoingId = outgoing.id;
      info(`outgoing: ${outgoing.id}`);

      const result = await pollOutgoing({
        outgoingUrl: outgoing.id,
        outgoingToken: token.accessToken,
        incomingUrl: incoming.id,
        incomingToken,
        quoteReceiveAmount: quote.receiveAmount,
        onAttempt: printAttempt,
      });
      report.status = result.status;
      report.detail =
        `sent ${toDisplay(result.outgoing.sentAmount)} / debit ${toDisplay(result.outgoing.debitAmount)}` +
        ` | received ${toDisplay(result.incoming.receivedAmount)}`;
      try {
        await completeIncomingPayment({ url: incoming.id, accessToken: incomingToken });
      } catch (error) {
        printError(error);
      }
    } catch (error) {
      printError(error);
      report.status = "rejected";
      report.detail = toOpError("payment", error).toLogString();
    }
    return report;
  }

  const first = await pay("A 1.00", recipientA, "1.00");
  const second = await pay("B 2.00", recipientB, "2.00");

  try {
    const spent = await getGrantSpentAmounts({ payer, accessToken: token.accessToken });
    step(
      "Gastado del grant",
      `debit ${spent.spentDebitAmount ? toDisplay(spent.spentDebitAmount) : "null"}` +
        ` | receive ${spent.spentReceiveAmount ? toDisplay(spent.spentReceiveAmount) : "null"}`,
    );
  } catch (error) {
    step("Gastado del grant: no disponible");
    printError(error);
  }

  const third = await pay("A 0.50 (debe fallar)", recipientA, "0.50");

  // ---- Report ----
  const s1s2 = first.status === "completed" && second.status === "completed";
  const limitEnforced = third.status === "rejected" || third.status === "failed";
  console.log("\n================ RESULTADO S1 + S2 + S5 ================");
  console.log(`S1 (grant sin receiver, usado después): ${s1s2 ? "PASS" : "FAIL"}`);
  console.log(`S2 (2 pagos bajo un grant):             ${s1s2 ? "PASS" : "FAIL"}`);
  console.log(`S5 (rotación tras ${ROTATE_AFTER_MS / 1000} s):              ${s5}`);
  console.log(`Límite respetado (3er pago rechazado):  ${limitEnforced ? "PASS" : "FAIL ⚠ el límite NO se aplicó"}`);
  console.log(`hash coincide: ${hashMatches ? "sí" : "no"}`);
  for (const r of [first, second, third]) {
    console.log(`\n[${r.label}] ${r.status}`);
    if (r.incomingId) console.log(`  incoming: ${r.incomingId}`);
    if (r.quoteId) console.log(`  quote:    ${r.quoteId}`);
    if (r.outgoingId) console.log(`  outgoing: ${r.outgoingId}`);
    if (r.detail) console.log(`  ${r.detail}`);
  }
  console.log("\nCopia este bloque en docs/spikes.md.");
  if (!s1s2 || !limitEnforced) process.exitCode = 1;
}

main().catch((e) => {
  printError(e);
  process.exit(1);
});
