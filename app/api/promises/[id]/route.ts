import { freelancerKeyOf, handle, json } from "@/lib/api/http";
import { toPromiseView } from "@/lib/api/mappers";
import type { PromiseView } from "@/lib/api/types";
import { assertFreelancerKey } from "@/lib/domain/access";
import { getPromiseDetails } from "@/lib/domain/details";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

/** Freelancer view: promise, allocations and latest payment per allocation. Poll this during payment day. */
export async function GET(request: Request, ctx: RouteContext<"/api/promises/[id]">) {
  return handle("GET /api/promises/[id]", async () => {
    const { id } = await ctx.params;
    assertFreelancerKey(id, freelancerKeyOf(request));
    const { promise, allocations, payments } = getPromiseDetails(id);
    return json<PromiseView>(toPromiseView(promise, allocations, payments, getEnv().appBaseUrl));
  });
}
