export type DomainErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "INVALID_APPROVAL_TOKEN"
  | "INVALID_HASH"
  | "ALLOCATION_EXCEEDS_TOTAL"
  | "ASSET_MISMATCH"
  | "PAYER_REJECTED"
  | "VALIDATION_ERROR"
  | "GRANT_LIMIT_EXCEEDED"
  | "OP_ERROR";

const HTTP_STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  INVALID_APPROVAL_TOKEN: 404, // same as NOT_FOUND: do not confirm the promise exists
  INVALID_HASH: 400,
  ALLOCATION_EXCEEDS_TOTAL: 422,
  ASSET_MISMATCH: 422,
  PAYER_REJECTED: 400,
  VALIDATION_ERROR: 400,
  GRANT_LIMIT_EXCEEDED: 409,
  OP_ERROR: 502,
};

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly httpStatus: number;

  constructor(code: DomainErrorCode, message: string, httpStatus: number = HTTP_STATUS[code]) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
