import { freelancerKeyOf, handle } from "@/lib/api/http";
import { toRecordsPack } from "@/lib/api/mappers";
import { assertFreelancerKey } from "@/lib/domain/access";
import { getPromiseHistory } from "@/lib/domain/details";

export const runtime = "nodejs";

/** Downloadable JSON records pack for the freelancer's accountant. */
export async function GET(request: Request, ctx: RouteContext<"/api/promises/[id]/records">) {
  return handle("GET /api/promises/[id]/records", async () => {
    const { id } = await ctx.params;
    assertFreelancerKey(id, freelancerKeyOf(request));
    const { promise, allocations, payments, events } = getPromiseHistory(id);
    const pack = toRecordsPack(promise, allocations, payments, events);
    return new Response(JSON.stringify(pack, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="alive-records-${promise.id}.json"`,
        "cache-control": "no-store",
      },
    });
  });
}
