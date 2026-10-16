import { after } from "next/server";
import { freelancerKeyOf, handle, json } from "@/lib/api/http";
import type { ExecuteResponse } from "@/lib/api/types";
import { assertFreelancerKey } from "@/lib/domain/access";
import { lockForExecution, runExecution } from "@/lib/domain/payout";

export const runtime = "nodejs";
// after() runs within the route's max duration on serverless hosts; payment day
// for a few allocations takes well under this. Locally (next dev/start) it is unbounded.
export const maxDuration = 300;

/**
 * "Payment day". Takes the lock synchronously (409 if already running or at
 * risk), answers 202 and runs the pipeline after the response. Poll
 * GET /api/promises/[id] for progress.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/promises/[id]/execute">) {
  return handle("POST /api/promises/[id]/execute", async () => {
    const { id } = await ctx.params;
    assertFreelancerKey(id, freelancerKeyOf(request));
    lockForExecution(id);
    after(async () => {
      const result = await runExecution(id); // never throws; logs ids and statuses only
      console.info(`[execute] promise ${id} finished: ${result.status}`);
    });
    return json<ExecuteResponse>({ status: "executing" }, 202);
  });
}
