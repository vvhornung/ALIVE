import { freelancerKeyOf, handle, json, parseBody } from "@/lib/api/http";
import { toPromiseView } from "@/lib/api/mappers";
import { revokeSimSchema } from "@/lib/api/schemas";
import type { PromiseView } from "@/lib/api/types";
import { assertFreelancerKey } from "@/lib/domain/access";
import { getPromiseDetails } from "@/lib/domain/details";
import { setSimulatedRevocation } from "@/lib/domain/revocation";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

/** SIMULATED revocation toggle for the demo: {revoked: true} → at_risk, {revoked: false} → active. */
export async function POST(request: Request, ctx: RouteContext<"/api/promises/[id]/revoke-sim">) {
  return handle("POST /api/promises/[id]/revoke-sim", async () => {
    const { id } = await ctx.params;
    assertFreelancerKey(id, freelancerKeyOf(request));
    const body = await parseBody(request, revokeSimSchema);
    setSimulatedRevocation(id, body.revoked);
    const { promise, allocations, payments } = getPromiseDetails(id);
    return json<PromiseView>(toPromiseView(promise, allocations, payments, getEnv().appBaseUrl));
  });
}
