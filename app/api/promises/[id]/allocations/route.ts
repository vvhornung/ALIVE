import { handle, json, parseBody } from "@/lib/api/http";
import { toPromiseView } from "@/lib/api/mappers";
import { allocationsSchema } from "@/lib/api/schemas";
import type { PromiseView } from "@/lib/api/types";
import { replaceAllocations } from "@/lib/domain/allocations";
import { getPromiseOrThrow } from "@/lib/domain/promises";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

/** Replaces all allocations of a promise; returns the updated promise. */
export async function POST(request: Request, ctx: RouteContext<"/api/promises/[id]/allocations">) {
  return handle("POST /api/promises/[id]/allocations", async () => {
    const { id } = await ctx.params;
    const body = await parseBody(request, allocationsSchema);
    const allocations = await replaceAllocations(id, body.allocations);
    return json<PromiseView>(toPromiseView(getPromiseOrThrow(id), allocations, getEnv().appBaseUrl));
  });
}
