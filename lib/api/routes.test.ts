// Route-level tests: real handlers + in-memory DB, with lib/op and after() mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getApproval } from "@/app/api/approve/[approvalToken]/route";
import { GET as callback } from "@/app/api/grants/callback/[id]/route";
import { POST as postAllocations } from "@/app/api/promises/[id]/allocations/route";
import { POST as authorize } from "@/app/api/promises/[id]/authorize/route";
import { GET as getEvents } from "@/app/api/promises/[id]/events/route";
import { POST as execute } from "@/app/api/promises/[id]/execute/route";
import { GET as getRecords } from "@/app/api/promises/[id]/records/route";
import { POST as revokeSim } from "@/app/api/promises/[id]/revoke-sim/route";
import { GET as getPromise } from "@/app/api/promises/[id]/route";
import { POST as createPromiseRoute } from "@/app/api/promises/route";
import { GET as getStatus } from "@/app/api/status/[token]/route";
import { listEvents, resetDbForTests } from "@/lib/db";
import {
  continueGrant,
  createFixedDebitQuote,
  createOpenIncomingPayment,
  createOutgoingPayment,
  OpError,
  pollOutgoing,
  requestIncomingGrant,
  requestOutgoingGrant,
  requestQuoteGrant,
  resolveWallet,
  rotateToken,
  verifyInteractHash,
} from "@/lib/op";
import { ACTIVE_GRANT, PENDING_GRANT, resolveByName } from "@/test/opMock";
import type { CreatePromiseResponse, ErrorResponse, EventsResponse, PromiseView, PublicStatusView, RecordsPack } from "./types";

const afterTasks: Promise<unknown>[] = [];
vi.mock("next/server", () => ({
  after: (task: () => Promise<unknown>) => {
    afterTasks.push(Promise.resolve().then(task));
  },
}));

vi.mock("@/lib/op", async () => ({
  ...(await vi.importActual<typeof import("@/lib/op/errors")>("@/lib/op/errors")),
  resolveWallet: vi.fn(),
  requestOutgoingGrant: vi.fn(),
  continueGrant: vi.fn(),
  verifyInteractHash: vi.fn(),
  rotateToken: vi.fn(),
  requestQuoteGrant: vi.fn(),
  requestIncomingGrant: vi.fn(),
  createOpenIncomingPayment: vi.fn(),
  createFixedDebitQuote: vi.fn(),
  getQuote: vi.fn(),
  isQuoteExpired: vi.fn(() => false),
  createOutgoingPayment: vi.fn(),
  findOutgoingPaymentByQuote: vi.fn(async () => undefined),
  pollOutgoing: vi.fn(),
  completeIncomingPayment: vi.fn(async () => ({})),
  getGrantSpentAmounts: vi.fn(async () => ({ spentDebitAmount: null, spentReceiveAmount: null })),
}));

const fake = <T>(value: object): T => value as T;
const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });
const BASE = "http://localhost:3000";
const send = (url: string, method: string, body?: unknown, key?: string | null) =>
  new Request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", ...(key ? { "x-freelancer-key": key } : {}) },
  });
const inTwoDays = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

async function create(): Promise<CreatePromiseResponse> {
  const res = await createPromiseRoute(
    send(`${BASE}/api/promises`, "POST", {
      freelancerWallet: "https://ilp.interledger-test.dev/ana",
      amount: "3.00",
      assetCode: "usd",
      dueAt: inTwoDays(),
      description: "Logo",
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as CreatePromiseResponse;
}

const tokenOf = (approvalUrl: string) => approvalUrl.split("/approve/")[1];

async function approve(created: CreatePromiseResponse) {
  const id = created.promise.id;
  const approvalToken = tokenOf(created.approvalUrl);
  await authorize(
    send(`${BASE}/api/promises/${id}/authorize`, "POST", { approvalToken, payerWallet: "https://ilp.interledger-test.dev/payer" }),
    ctx({ id }),
  );
  await callback(new Request(`${BASE}/api/grants/callback/${id}?interact_ref=ref&hash=h`), ctx({ id }));
}

async function allocate(created: CreatePromiseResponse) {
  const id = created.promise.id;
  const res = await postAllocations(
    send(
      `${BASE}/api/promises/${id}/allocations`,
      "POST",
      {
        allocations: [
          { label: "Me", recipientWallet: "https://ilp.interledger-test.dev/ana", amount: "1.50" },
          { label: "Rent", recipientWallet: "https://ilp.interledger-test.dev/landlord", amount: "1.00" },
          { label: "PILA fund", recipientWallet: "https://ilp.interledger-test.dev/pila", amount: "0.50", simulated: true },
        ],
      },
      created.freelancerKey,
    ),
    ctx({ id }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as PromiseView;
}

async function view(created: CreatePromiseResponse): Promise<PromiseView> {
  const res = await getPromise(send(BASE, "GET", undefined, created.freelancerKey), ctx({ id: created.promise.id }));
  expect(res.status).toBe(200);
  return (await res.json()) as PromiseView;
}

let seq = 0;
beforeEach(() => {
  resetDbForTests();
  afterTasks.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.mocked(resolveWallet).mockReset().mockImplementation(resolveByName());
  vi.mocked(requestOutgoingGrant).mockReset().mockResolvedValue(PENDING_GRANT);
  vi.mocked(continueGrant).mockReset().mockResolvedValue(ACTIVE_GRANT);
  vi.mocked(verifyInteractHash).mockReset().mockReturnValue(true);
  vi.mocked(rotateToken).mockReset().mockResolvedValue({ ...ACTIVE_GRANT, accessToken: "SECRET-rotated" });
  vi.mocked(requestQuoteGrant).mockReset().mockResolvedValue("SECRET-quote");
  vi.mocked(requestIncomingGrant).mockReset().mockResolvedValue("SECRET-incoming");
  vi.mocked(createOpenIncomingPayment).mockReset().mockImplementation(async () => fake({ id: `https://rs.test/incoming/${++seq}` }));
  vi.mocked(createFixedDebitQuote)
    .mockReset()
    .mockImplementation(async (a) =>
      fake({ id: `https://rs.test/quotes/${++seq}`, debitAmount: a.debitAmount, receiveAmount: a.debitAmount }),
    );
  vi.mocked(createOutgoingPayment).mockReset().mockImplementation(async () => fake({ id: `https://rs.test/outgoing/${++seq}` }));
  vi.mocked(pollOutgoing)
    .mockReset()
    .mockImplementation(async (a) =>
      fake({ status: "completed", attempts: 1, outgoing: { failed: false }, incoming: { receivedAmount: a.quoteReceiveAmount } }),
    );
});

describe("POST /api/promises", () => {
  it("returns the promise, approval URL, freelancer key and dashboard URL", async () => {
    const body = await create();
    expect(body.promise).toMatchObject({ status: "awaiting_approval", amount: { value: "300", display: "3.00 USD" } });
    expect(body.approvalUrl).toMatch(/^http:\/\/localhost:3000\/approve\/[\w-]{40,}$/);
    expect(body.freelancerKey).toMatch(/^[\w-]{43}$/);
    expect(body.dashboardUrl).toBe(`${BASE}/dashboard/${body.promise.id}#k=${body.freelancerKey}`);
  });

  it("rejects a JSON number amount with a 400", async () => {
    const res = await createPromiseRoute(
      send(`${BASE}/api/promises`, "POST", { freelancerWallet: "https://x.dev/a", amount: 300, assetCode: "USD", dueAt: inTwoDays() }),
    );
    expect(res.status).toBe(400);
  });

  it("maps an unknown wallet to 400 WALLET_NOT_FOUND", async () => {
    vi.mocked(resolveWallet).mockRejectedValue(new OpError("wallet.get", "Not found", { status: 404 }));
    const res = await createPromiseRoute(
      send(`${BASE}/api/promises`, "POST", { freelancerWallet: "https://x.dev/a", amount: "1", assetCode: "USD", dueAt: inTwoDays() }),
    );
    expect(((await res.json()) as ErrorResponse).error.code).toBe("WALLET_NOT_FOUND");
  });
});

describe("freelancer key", () => {
  it("is required on every freelancer route; missing or wrong → 404", async () => {
    const created = await create();
    const id = created.promise.id;
    for (const key of [null, "wrong-key"]) {
      const calls: Response[] = [
        await getPromise(send(BASE, "GET", undefined, key), ctx({ id })),
        await postAllocations(send(BASE, "POST", { allocations: [] }, key), ctx({ id })),
        await execute(send(BASE, "POST", undefined, key), ctx({ id })),
        await revokeSim(send(BASE, "POST", { revoked: true }, key), ctx({ id })),
        await getEvents(send(BASE, "GET", undefined, key), ctx({ id })),
        await getRecords(send(BASE, "GET", undefined, key), ctx({ id })),
      ];
      for (const res of calls) {
        expect(res.status).toBe(404);
        expect(((await res.json()) as ErrorResponse).error.code).toBe("NOT_FOUND");
      }
    }
  });
});

describe("approval flow over HTTP", () => {
  it("approve page → authorize → callback approved → active", async () => {
    const created = await create();
    const approvalToken = tokenOf(created.approvalUrl);
    const page = await getApproval(new Request(created.approvalUrl), ctx({ approvalToken }));
    expect(await page.json()).toMatchObject({ promiseId: created.promise.id, testMode: true, reapprovalNeeded: false });
    await approve(created);
    const v = await view(created);
    expect(v.status).toBe("active");
    expect(JSON.stringify(v)).not.toContain("SECRET-");
    expect(JSON.stringify(v)).not.toContain(approvalToken);
    expect(JSON.stringify(v)).not.toContain(created.freelancerKey);
  });

  it("callback without interact_ref → result=rejected, stays awaiting_approval", async () => {
    const created = await create();
    const id = created.promise.id;
    const approvalToken = tokenOf(created.approvalUrl);
    await authorize(
      send(`${BASE}/api/promises/${id}/authorize`, "POST", { approvalToken, payerWallet: "https://ilp.interledger-test.dev/payer" }),
      ctx({ id }),
    );
    const cb = await callback(new Request(`${BASE}/api/grants/callback/${id}`), ctx({ id }));
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe(`${BASE}/approve/${approvalToken}?result=rejected`);
    expect(continueGrant).not.toHaveBeenCalled();
    expect((await view(created)).status).toBe("awaiting_approval");
  });

  it("callback when continue fails → result=error", async () => {
    const created = await create();
    const id = created.promise.id;
    const approvalToken = tokenOf(created.approvalUrl);
    await authorize(
      send(`${BASE}/api/promises/${id}/authorize`, "POST", { approvalToken, payerWallet: "https://ilp.interledger-test.dev/payer" }),
      ctx({ id }),
    );
    vi.mocked(continueGrant).mockRejectedValue(new OpError("grant.continue", "Invalid interact_ref", { status: 401 }));
    const cb = await callback(new Request(`${BASE}/api/grants/callback/${id}?interact_ref=used&hash=h`), ctx({ id }));
    expect(cb.headers.get("location")).toBe(`${BASE}/approve/${approvalToken}?result=error`);
  });
});

describe("payment day over HTTP", () => {
  it("execute → 202, runs in after(), completes; status, events and records reflect it", async () => {
    const created = await create();
    const id = created.promise.id;
    await approve(created);
    const allocated = await allocate(created);

    const res = await execute(send(BASE, "POST", undefined, created.freelancerKey), ctx({ id }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "executing" });
    expect((await view(created)).status).toBe("executing");

    // A second click while running is refused.
    const again = await execute(send(BASE, "POST", undefined, created.freelancerKey), ctx({ id }));
    expect(again.status).toBe(409);

    await Promise.all(afterTasks);
    const done = await view(created);
    expect(done.status).toBe("completed");
    expect(done.allocations.map((a) => [a.label, a.status, a.payment?.step])).toEqual([
      ["Me", "paid", "completed"],
      ["Rent", "paid", "completed"],
      ["PILA fund", "paid", "completed"],
    ]);
    expect(JSON.stringify(done)).not.toContain("https://rs.test");

    const statusToken = allocated.allocations[1].statusUrl.split("/status/")[1];
    const status = (await (await getStatus(new Request(BASE), ctx({ token: statusToken }))).json()) as PublicStatusView;
    expect(status).toMatchObject({ label: "Rent", status: "paid", payment: { step: "completed" } });
    expect(JSON.stringify(status)).not.toContain("https://rs.test");

    const events = (await (await getEvents(send(BASE, "GET", undefined, created.freelancerKey), ctx({ id }))).json()) as EventsResponse;
    expect(events.events.at(-1)?.summary).toBe("Payment day completed: 3 of 3 paid");
    const eventsJson = JSON.stringify(events);
    expect(eventsJson).not.toContain("SECRET-");
    expect(eventsJson).not.toContain("https://rs.test");

    const records = await getRecords(send(BASE, "GET", undefined, created.freelancerKey), ctx({ id }));
    expect(records.headers.get("content-disposition")).toBe(`attachment; filename="alive-records-${id}.json"`);
    const pack = (await records.json()) as RecordsPack;
    expect(pack.disclaimer).toBe("Records generated by ALIVE; not a legal or tax document.");
    expect(pack.payments).toHaveLength(3);
    expect(pack.payments[0].outgoingPaymentUrl).toMatch(/^https:\/\/rs\.test\/outgoing\//);
    const packJson = JSON.stringify(pack);
    expect(packJson).not.toContain("SECRET-");
    expect(packJson).not.toContain(created.freelancerKey);
    expect(packJson).not.toContain(tokenOf(created.approvalUrl));
  });

  it("revoke-sim: at_risk blocks execute with 'Payer authorization at risk', then clears", async () => {
    const created = await create();
    const id = created.promise.id;
    await approve(created);
    await allocate(created);

    const revoked = (await (await revokeSim(send(BASE, "POST", { revoked: true }, created.freelancerKey), ctx({ id }))).json()) as PromiseView;
    expect(revoked).toMatchObject({ status: "at_risk", atRisk: { reason: "simulated_revocation", simulated: true } });

    const blocked = await execute(send(BASE, "POST", undefined, created.freelancerKey), ctx({ id }));
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as ErrorResponse).error.message).toBe("Payer authorization at risk");

    const cleared = (await (await revokeSim(send(BASE, "POST", { revoked: false }, created.freelancerKey), ctx({ id }))).json()) as PromiseView;
    expect(cleared).toMatchObject({ status: "active", atRisk: null });
    expect(listEvents(id).map((e) => e.type)).toEqual(expect.arrayContaining(["revocation_simulated", "revocation_cleared"]));
  });

  it("422 when allocations exceed the total", async () => {
    const created = await create();
    const res = await postAllocations(
      send(
        BASE,
        "POST",
        { allocations: [{ label: "Rent", recipientWallet: "https://ilp.interledger-test.dev/l", amount: "3.01" }] },
        created.freelancerKey,
      ),
      ctx({ id: created.promise.id }),
    );
    expect(res.status).toBe(422);
  });
});
