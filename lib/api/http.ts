// Thin-route helpers: parse input with zod, run the domain call, map typed
// errors to { error: { code, message } }. Logs carry codes and ids only.
import type { z } from "zod";
import { FREELANCER_KEY_HEADER } from "@/lib/domain/access";
import { DomainError } from "@/lib/domain/errors";
import { OpError } from "@/lib/op";
import type { ErrorResponse } from "./types";

/** The freelancer key header (never logged). */
export const freelancerKeyOf = (request: Request): string | null => request.headers.get(FREELANCER_KEY_HEADER);

export function json<T>(body: T, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function errorJson(status: number, code: string, message: string): Response {
  return json<ErrorResponse>({ error: { code, message } }, status);
}

export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new DomainError("VALIDATION_ERROR", "Request body must be JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new DomainError("VALIDATION_ERROR", message);
  }
  return parsed.data;
}

/** Safe log line: error codes, OP status/description, never tokens. */
export function logError(error: unknown, context: string): void {
  if (error instanceof DomainError) console.warn(`[${context}] ${error.code}: ${error.message}`);
  else if (error instanceof OpError) console.error(`[${context}] OP_ERROR ${error.toLogString()}`);
  else console.error(`[${context}] unexpected ${error instanceof Error ? error.name : typeof error}`);
}

/** Maps any thrown error to a JSON response. `context` is the route name for logs. */
export function toErrorResponse(error: unknown, context: string): Response {
  if (error instanceof DomainError) {
    if (error.httpStatus >= 500) logError(error, context);
    return errorJson(error.httpStatus, error.code, error.message);
  }
  logError(error, context);
  if (error instanceof OpError) {
    if (error.step === "wallet.normalize") return errorJson(400, "VALIDATION_ERROR", error.message);
    if (error.step === "wallet.get" && (error.status === undefined || error.status < 500)) {
      return errorJson(400, "WALLET_NOT_FOUND", "That wallet address could not be found. Check it and try again.");
    }
    const detail = error.description ? `: ${error.description}` : "";
    return errorJson(502, "OP_ERROR", `The wallet provider rejected the request${detail}`);
  }
  return errorJson(500, "INTERNAL_ERROR", "Something went wrong");
}

export async function handle(context: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    return toErrorResponse(error, context);
  }
}
