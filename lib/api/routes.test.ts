// Route-level tests: real handlers + in-memory DB, with lib/op mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getApproval } from "@/app/api/approve/[approvalToken]/route";
import { GET as callback } from "@/app/api/grants/callback/[id]/route";
import { POST as postAllocations } from "@/app/api/promises/[id]/allocations/route";
import { POST as authorize } from "@/app/api/promises/[id]/authorize/route";
import { GET as getPromise } from "@/app/api/promises/[id]/route";
import { POST as createPromiseRoute } from "@/app/api/promises/route";
import { GET as getStatus } from "@/app/api/status/[token]/route";
import { listEvents, resetDbForTests } from "@/lib/db";
import { continueGrant, OpError, requestOutgoingGrant, resolveWallet, verifyInteractHash } from "@/lib/op";
import { ACTIVE_GRANT, PENDING_GRANT, resolveByName } from "@/test/opMock";
import type { CreatePromiseResponse, ErrorResponse, PromiseView } from "./types";

vi.mock("@/lib/op", async () => ({
  ...(await vi.importActual<typeof import("@/lib/op/errors")>("@/lib/op/errors")),
  resolveWallet: vi.fn(),
  requestOutgoingGrant: vi.fn(),
  continueGrant: vi.fn(),
  verifyInteractHash: vi.fn(),
}));

const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });
const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const BASE = "http://localhost:3000";
const tomorrow = () => {
  const d = new Date(Date.now() + 2 * 86_400_000);
  return d.toISOString().slice(0, 10);
};

async function create(): Promise<CreatePromiseResponse> {
  const res = await createPromiseRoute(
    post(`${BASE}/api/promises`, {
      freelancerWallet: "https://ilp.interledger-test.dev/ana",
      amount: "300.00",
      assetCode: "usd",
      dueAt: tomorrow(),
      description: "Logo",
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as CreatePromiseResponse;
}

const tokenOf = (approvalUrl: string) => approvalUrl.split("/approve/")[1];

beforeEach(() => {
  resetDbForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(resolveWallet).mockReset().mockImplementation(resolveByName());
  vi.mocked(requestOutgoingGrant).mockReset().mockResolvedValue(PENDING_GRANT);
  vi.mocked(continueGrant).mockReset().mockResolvedValue(ACTIVE_GRANT);
  vi.mocked(verifyInteractHash).mockReset().mockReturnValue(true);
});

describe("POST /api/promises", () => {
  it("returns the promise and the approval URL", async () => {
    const body = await create();
    expect(body.promise).toMatchObject({ status: "awaiting_approval", amount: { value: "30000", display: "300.00 USD" } });
    expect(body.approvalUrl).toMatch(/^http:\/\/localhost:3000\/approve\/[\w-]{40,}$/);
  });

  it("rejects a JSON number amount with a 400", async () => {
    const res = await createPromiseRoute(
      post(`${BASE}/api/promises`, { freelancerWallet: "https://x.dev/a", amount: 300, assetCode: "USD", dueAt: tomorrow() }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorResponse).error.code).toBe("VALIDATION_ERROR");
  });

  it("maps an unknown wallet to 400 WALLET_NOT_FOUND", async () => {
    vi.mocked(resolveWallet).mockRejectedValue(new OpError("wallet.get", "Not found", { status: 404 }));
    const res = await createPromiseRoute(
      post(`${BASE}/api/promises`, { freelancerWallet: "https://x.dev/a", amount: "1", assetCode: "USD", dueAt: tomorrow() }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorResponse).error.code).toBe("WALLET_NOT_FOUND");
  });
});

describe("approval flow over HTTP", () => {
  it("approve page → authorize → callback approved → promise active", async () => {
    const { promise, approvalUrl } = await create();
    const approvalToken = tokenOf(approvalUrl);

    const page = await getApproval(new Request(approvalUrl), ctx({ approvalToken }));
    expect(await page.json()).toMatchObject({ promiseId: promise.id, freelancerName: "Ana", testMode: true });

    const auth = await authorize(
      post(`${BASE}/api/promises/${promise.id}/authorize`, { approvalToken, payerWallet: "$ilp.interledger-test.dev/payer" }),
      ctx({ id: promise.id }),
    );
    expect(await auth.json()).toEqual({ redirectUrl: PENDING_GRANT.redirectUrl });

    const cb = await callback(
      new Request(`${BASE}/api/grants/callback/${promise.id}?interact_ref=ref&hash=h`),
      ctx({ id: promise.id }),
    );
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe(`${BASE}/approve/${approvalToken}?result=approved`);

    const view = (await (await getPromise(new Request(BASE), ctx({ id: promise.id }))).json()) as PromiseView;
    expect(view.status).toBe("active");
    expect(view.payerWallet).toBe("https://ilp.interledger-test.dev/payer");
    expect(JSON.stringify(view)).not.toContain("SECRET-");
    expect(JSON.stringify(view)).not.toContain(approvalToken);
  });

  it("callback without interact_ref → result=rejected, stays awaiting_approval", async () => {
    const { promise, approvalUrl } = await create();
    const approvalToken = tokenOf(approvalUrl);
    await authorize(
      post(`${BASE}/api/promises/${promise.id}/authorize`, { approvalToken, payerWallet: "https://ilp.interledger-test.dev/payer" }),
      ctx({ id: promise.id }),
    );
    const cb = await callback(new Request(`${BASE}/api/grants/callback/${promise.id}`), ctx({ id: promise.id }));
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe(`${BASE}/approve/${approvalToken}?result=rejected`);
    expect(continueGrant).not.toHaveBeenCalled();
    expect(listEvents(promise.id).map((e) => e.type)).toContain("payer_rejected");
    const view = (await (await getPromise(new Request(BASE), ctx({ id: promise.id }))).json()) as PromiseView;
    expect(view.status).toBe("awaiting_approval");
  });

  it("callback when continue fails → result=error", async () => {
    const { promise, approvalUrl } = await create();
    const approvalToken = tokenOf(approvalUrl);
    await authorize(
      post(`${BASE}/api/promises/${promise.id}/authorize`, { approvalToken, payerWallet: "https://ilp.interledger-test.dev/payer" }),
      ctx({ id: promise.id }),
    );
    vi.mocked(continueGrant).mockRejectedValue(new OpError("grant.continue", "Invalid interact_ref", { status: 401 }));
    const cb = await callback(
      new Request(`${BASE}/api/grants/callback/${promise.id}?interact_ref=used&hash=h`),
      ctx({ id: promise.id }),
    );
    expect(cb.headers.get("location")).toBe(`${BASE}/approve/${approvalToken}?result=error`);
  });

  it("callback for an unknown promise → 404 JSON", async () => {
    const res = await callback(new Request(`${BASE}/api/grants/callback/nope?interact_ref=x`), ctx({ id: "nope" }));
    expect(res.status).toBe(404);
  });

  it("authorize with a wrong approval token → 404", async () => {
    const { promise } = await create();
    const res = await authorize(
      post(`${BASE}/api/promises/${promise.id}/authorize`, { approvalToken: "nope", payerWallet: "https://ilp.interledger-test.dev/payer" }),
      ctx({ id: promise.id }),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorResponse).error.code).toBe("INVALID_APPROVAL_TOKEN");
  });
});

describe("allocations and status", () => {
  it("422 when allocations exceed the total; status page works for a valid set", async () => {
    const { promise } = await create();
    const over = await postAllocations(
      post(`${BASE}/api/promises/${promise.id}/allocations`, {
        allocations: [{ label: "Rent", recipientWallet: "https://ilp.interledger-test.dev/landlord", amount: "300.01" }],
      }),
      ctx({ id: promise.id }),
    );
    expect(over.status).toBe(422);
    expect(((await over.json()) as ErrorResponse).error.code).toBe("ALLOCATION_EXCEEDS_TOTAL");

    const ok = await postAllocations(
      post(`${BASE}/api/promises/${promise.id}/allocations`, {
        allocations: [
          { label: "Rent", recipientWallet: "https://ilp.interledger-test.dev/landlord", amount: "200" },
          { label: "PILA", recipientWallet: "https://ilp.interledger-test.dev/pila", amount: "100", simulated: true },
        ],
      }),
      ctx({ id: promise.id }),
    );
    const view = (await ok.json()) as PromiseView;
    expect(view.unallocated.value).toBe("0");
    const statusToken = view.allocations[1].statusUrl.split("/status/")[1];
    const status = await getStatus(new Request(BASE), ctx({ token: statusToken }));
    expect(await status.json()).toMatchObject({ label: "PILA", simulated: true, status: "pending", testMode: true });

    const missing = await getStatus(new Request(BASE), ctx({ token: "nope" }));
    expect(missing.status).toBe(404);
  });
});
