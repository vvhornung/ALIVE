import { logError, toErrorResponse } from "@/lib/api/http";
import { completeAuthorization, getPromiseOrThrow, rejectAuthorization } from "@/lib/domain/promises";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

type Result = "approved" | "rejected" | "error";

/**
 * The payer's wallet redirects here after consent with ?interact_ref&hash
 * (no interact_ref = declined). Always ends in a 302 to the approval page.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/grants/callback/[id]">) {
  const { id } = await ctx.params;
  let approvalToken: string;
  try {
    approvalToken = getPromiseOrThrow(id).approvalToken;
  } catch (error) {
    return toErrorResponse(error, "GET /api/grants/callback/[id]");
  }

  const params = new URL(request.url).searchParams;
  const interactRef = params.get("interact_ref");
  const hash = params.get("hash") ?? undefined;

  let result: Result;
  try {
    if (!interactRef) {
      rejectAuthorization(id);
      result = "rejected";
    } else {
      await completeAuthorization(id, interactRef, hash);
      result = "approved";
    }
  } catch (error) {
    logError(error, "GET /api/grants/callback/[id]");
    result = "error";
  }
  return Response.redirect(`${getEnv().appBaseUrl}/approve/${approvalToken}?result=${result}`, 302);
}
