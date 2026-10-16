import { handle, json } from "@/lib/api/http";
import { toApprovalView } from "@/lib/api/mappers";
import type { ApprovalView } from "@/lib/api/types";
import { getPromiseByApprovalTokenOrThrow } from "@/lib/domain/promises";

export const runtime = "nodejs";

/** Minimal public info for the payer approval page. */
export async function GET(_request: Request, ctx: RouteContext<"/api/approve/[approvalToken]">) {
  return handle("GET /api/approve/[approvalToken]", async () => {
    const { approvalToken } = await ctx.params;
    return json<ApprovalView>(toApprovalView(getPromiseByApprovalTokenOrThrow(approvalToken)));
  });
}
