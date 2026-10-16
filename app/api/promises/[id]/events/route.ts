import { freelancerKeyOf, handle, json } from "@/lib/api/http";
import { toTimeline } from "@/lib/api/mappers";
import type { EventsResponse } from "@/lib/api/types";
import { assertFreelancerKey } from "@/lib/domain/access";
import { getPromiseHistory } from "@/lib/domain/details";

export const runtime = "nodejs";

/** Timeline for the dashboard: [{type, at, summary}], no payloads, no URLs. */
export async function GET(request: Request, ctx: RouteContext<"/api/promises/[id]/events">) {
  return handle("GET /api/promises/[id]/events", async () => {
    const { id } = await ctx.params;
    assertFreelancerKey(id, freelancerKeyOf(request));
    const { promise, allocations, payments, events } = getPromiseHistory(id);
    return json<EventsResponse>({ events: toTimeline(promise, events, allocations, payments) });
  });
}
