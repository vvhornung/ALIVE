import { handle, json, parseBody } from "@/lib/api/http";
import { authorizeSchema } from "@/lib/api/schemas";
import type { AuthorizeResponse } from "@/lib/api/types";
import { startAuthorization } from "@/lib/domain/promises";

export const runtime = "nodejs";

/** Payer submits their wallet; returns the wallet's consent URL to redirect to. */
export async function POST(request: Request, ctx: RouteContext<"/api/promises/[id]/authorize">) {
  return handle("POST /api/promises/[id]/authorize", async () => {
    const { id } = await ctx.params;
    const body = await parseBody(request, authorizeSchema);
    const { redirectUrl } = await startAuthorization(id, body.approvalToken, body.payerWallet);
    return json<AuthorizeResponse>({ redirectUrl });
  });
}
