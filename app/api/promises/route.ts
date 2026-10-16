import { handle, json, parseBody } from "@/lib/api/http";
import { approvalUrlFor, dashboardUrlFor, toPromiseView } from "@/lib/api/mappers";
import { createPromiseSchema } from "@/lib/api/schemas";
import type { CreatePromiseResponse } from "@/lib/api/types";
import { createPromise } from "@/lib/domain/promises";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

/** Freelancer creates a promise; returns the payer link and the freelancer key (once). */
export async function POST(request: Request) {
  return handle("POST /api/promises", async () => {
    const body = await parseBody(request, createPromiseSchema);
    const { promise, approvalToken, freelancerKey } = await createPromise(body);
    const { appBaseUrl } = getEnv();
    return json<CreatePromiseResponse>(
      {
        promise: toPromiseView(promise, [], [], appBaseUrl),
        approvalUrl: approvalUrlFor(appBaseUrl, approvalToken),
        freelancerKey,
        dashboardUrl: dashboardUrlFor(appBaseUrl, promise.id, freelancerKey),
      },
      201,
    );
  });
}
