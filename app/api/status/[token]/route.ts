import { handle, json } from "@/lib/api/http";
import { toPublicStatusView } from "@/lib/api/mappers";
import type { PublicStatusView } from "@/lib/api/types";
import { getAllocationByStatusTokenOrThrow } from "@/lib/domain/allocations";

export const runtime = "nodejs";

/** Public, read-only status of one allocation. */
export async function GET(_request: Request, ctx: RouteContext<"/api/status/[token]">) {
  return handle("GET /api/status/[token]", async () => {
    const { token } = await ctx.params;
    const { allocation, promise } = getAllocationByStatusTokenOrThrow(token);
    return json<PublicStatusView>(toPublicStatusView(promise, allocation));
  });
}
