import { handle, json } from "@/lib/api/http";
import { toPublicStatusView } from "@/lib/api/mappers";
import type { PublicStatusView } from "@/lib/api/types";
import { getPublicStatus } from "@/lib/domain/details";

export const runtime = "nodejs";

/** Public, read-only status of one allocation (no internal URLs, no error details). */
export async function GET(_request: Request, ctx: RouteContext<"/api/status/[token]">) {
  return handle("GET /api/status/[token]", async () => {
    const { token } = await ctx.params;
    const { promise, allocation, payment } = getPublicStatus(token);
    return json<PublicStatusView>(toPublicStatusView(promise, allocation, payment));
  });
}
