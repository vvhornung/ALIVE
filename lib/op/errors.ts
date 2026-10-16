// Typed wrapper for Open Payments SDK failures. Keeps the fields we need to
// debug (status, code, description, validationErrors) and never any token.
import { OpenPaymentsClientError } from "@interledger/open-payments";

export class OpError extends Error {
  readonly step: string;
  readonly status?: number;
  readonly code?: string;
  readonly description?: string;
  readonly validationErrors?: string[];

  constructor(
    step: string,
    message: string,
    details: { status?: number; code?: string; description?: string; validationErrors?: string[] } = {},
  ) {
    super(`[${step}] ${message}`);
    this.name = "OpError";
    this.step = step;
    this.status = details.status;
    this.code = details.code;
    this.description = details.description;
    this.validationErrors = details.validationErrors;
  }

  /** Safe one-line summary for logs and the payments.error column. */
  toLogString(): string {
    const parts = [this.message];
    if (this.status !== undefined) parts.push(`status=${this.status}`);
    if (this.code) parts.push(`code=${this.code}`);
    if (this.description && !this.message.includes(this.description)) parts.push(`description=${this.description}`);
    if (this.validationErrors?.length) parts.push(`validationErrors=${this.validationErrors.join("; ")}`);
    return parts.join(" | ");
  }
}

/** Runs an SDK call and rethrows any failure as an OpError tagged with `step`. */
export async function wrapOp<T>(step: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw toOpError(step, error);
  }
}

export function toOpError(step: string, error: unknown): OpError {
  if (error instanceof OpError) return error;
  if (error instanceof OpenPaymentsClientError) {
    return new OpError(step, error.description || error.message, {
      status: error.status,
      code: error.code,
      description: error.description,
      validationErrors: error.validationErrors,
    });
  }
  return new OpError(step, error instanceof Error ? error.message : String(error));
}
