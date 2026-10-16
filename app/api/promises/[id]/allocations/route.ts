import { freelancerKeyOf, handle, json, parseBody } from "@/lib/api/http";
import { toPromiseView } from "@/lib/api/mappers";
import { allocationsSchema } from "@/lib/api/schemas";
import type { PromiseView } from "@/lib/api/types";
import { assertFreelancerKey } from "@/lib/domain/access";
import { replaceAllocations } from "@/lib/domain/allocations";
import { getPromiseDetails } from "@/lib/domain/details";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

/** Replaces all allocations of a promise; returns the updated promise. */
export async function POST(request: Request, ctx: RouteContext<"/api/promises/[id]/allocations">) {
  return handle("POST /api/promises/[id]/allocations", async () => {
    const { id } = await ctx.params;
    assertFreelancerKey(id, freelancerKeyOf(request));
    const body = await parseBody(request, allocationsSchema);
    await replaceAllocations(id, body.allocations);
    const { promise, allocations, payments } = getPromiseDetails(id);
    return json<PromiseView>(toPromiseView(promise, allocations, payments, getEnv().appBaseUrl));
  });
}
