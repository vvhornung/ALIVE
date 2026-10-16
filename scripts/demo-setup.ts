// Demo setup: talks to the RUNNING app over HTTP (start it with `npm run dev`).
// Creates a promise + 3 allocations (Me, Rent, PILA fund — simulated) and, if
// DEMO_PAYER_WALLET is set, starts the payer approval and prints the consent URL.
// Run: npm run demo:setup
import { todayInBogota } from "../lib/dates";
import type { AuthorizeResponse, CreatePromiseResponse, ErrorResponse, PromiseView } from "../lib/api/types";

const env = (name: string, fallback?: string): string => {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`Falta ${name} en .env.local (ver .env.example)`);
  return value;
};

async function call<T>(path: string, init: { method: string; body?: unknown; key?: string }): Promise<T> {
  const base = env("APP_BASE_URL", "http://localhost:3000").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method,
      headers: { "content-type": "application/json", ...(init.key ? { "x-freelancer-key": init.key } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new Error(`No se pudo conectar a ${base}. ¿Está corriendo \`npm run dev\`?`);
  }
  const data: unknown = await res.json();
  if (!res.ok) {
    const { error } = data as ErrorResponse;
    throw new Error(`${init.method} ${path} → ${res.status} ${error?.code}: ${error?.message}`);
  }
  return data as T;
}

async function main() {
  const freelancerWallet = env("DEMO_FREELANCER_WALLET");
  const assetCode = env("DEMO_ASSET_CODE", "USD");
  const amounts = {
    me: env("DEMO_ME_AMOUNT", "1.50"),
    rent: env("DEMO_RENT_AMOUNT", "1.00"),
    pila: env("DEMO_PILA_AMOUNT", "0.50"),
  };
  const total = env("DEMO_AMOUNT", "3.00");

  const created = await call<CreatePromiseResponse>("/api/promises", {
    method: "POST",
    body: {
      freelancerWallet,
      freelancerName: process.env.DEMO_FREELANCER_NAME?.trim() || undefined,
      amount: total,
      assetCode,
      dueAt: process.env.DEMO_DUE_AT?.trim() || todayInBogota(),
      description: process.env.DEMO_DESCRIPTION?.trim() || "Diseño de logo — demo ALIVE",
      invoiceRef: process.env.DEMO_INVOICE_REF?.trim() || `CC-DEMO-${Date.now()}`,
    },
  });
  const id = created.promise.id;
  const key = created.freelancerKey;

  const view = await call<PromiseView>(`/api/promises/${id}/allocations`, {
    method: "POST",
    key,
    body: {
      allocations: [
        { label: "Me", recipientWallet: freelancerWallet, amount: amounts.me },
        { label: "Rent", recipientWallet: env("DEMO_RENT_WALLET"), amount: amounts.rent },
        { label: "PILA fund", recipientWallet: env("DEMO_PILA_WALLET"), amount: amounts.pila, simulated: true },
      ],
    },
  });

  console.log(`\nPromesa creada: ${view.amount.display} para ${view.freelancer.name} (vence ${view.dueAt})`);
  for (const a of view.allocations) {
    console.log(`  - ${a.label}${a.simulated ? " (simulado)" : ""}: ${a.amount.display} → ${a.recipientWallet}`);
    console.log(`    estado público: ${a.statusUrl}`);
  }
  console.log(`\nLink para el pagador:  ${created.approvalUrl}`);
  console.log(`Dashboard freelancer:  ${created.dashboardUrl}`);

  const payerWallet = process.env.DEMO_PAYER_WALLET?.trim();
  if (payerWallet) {
    const approvalToken = created.approvalUrl.split("/approve/")[1];
    const { redirectUrl } = await call<AuthorizeResponse>(`/api/promises/${id}/authorize`, {
      method: "POST",
      body: { approvalToken, payerWallet },
    });
    console.log(`\nAbre esta URL, inicia sesión con la wallet PAGADORA y aprueba:\n\n  ${redirectUrl}\n`);
  } else {
    console.log("\n(DEMO_PAYER_WALLET vacío: abre el link del pagador cuando exista la UI.)");
  }

  console.log("Para los siguientes comandos en PowerShell (la llave es solo para esta demo; no la compartas):");
  console.log(`  $id = "${id}"; $key = "${key}"\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
