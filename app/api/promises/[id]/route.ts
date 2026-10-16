import { handle, json } from "@/lib/api/http";
import { toPromiseView } from "@/lib/api/mappers";
import type { PromiseView } from "@/lib/api/types";
import { getAllocations } from "@/lib/domain/allocations";
import { getPromiseOrThrow } from "@/lib/domain/promises";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

/** Freelancer view: promise with allocations. */
export async function GET(_request: Request, ctx: RouteContext<"/api/promises/[id]">) {
  return handle("GET /api/promises/[id]", async () => {
    const { id } = await ctx.params;
    const promise = getPromiseOrThrow(id);
    return json<PromiseView>(toPromiseView(promise, getAllocations(id), getEnv().appBaseUrl));
  });
}
