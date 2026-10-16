// Response DTOs shared with the frontend. These must NEVER contain grant
// tokens, nonces, continue/manage URIs or the approval token (the create
// response carries the approval link as `approvalUrl`, once).

export type MoneyView = {
  value: string; // integer string, minor units
  assetCode: string;
  assetScale: number;
  display: string; // e.g. "300.00 USD"
};

export type PromiseStatusView =
  | "draft"
  | "awaiting_approval"
  | "active"
  | "executing"
  | "completed"
  | "partially_failed"
  | "at_risk"
  | "expired";

export type AllocationStatusView = "pending" | "paying" | "paid" | "failed";

export type AllocationView = {
  id: string;
  label: string;
  recipientWallet: string;
  amount: MoneyView;
  status: AllocationStatusView;
  simulated: boolean;
  statusUrl: string; // public read-only page for this recipient
};

/** Freelancer view: GET /api/promises/[id]. */
export type PromiseView = {
  id: string;
  status: PromiseStatusView;
  freelancer: { wallet: string; name: string };
  payerWallet: string | null;
  amount: MoneyView;
  allocated: MoneyView;
  unallocated: MoneyView;
  dueAt: string; // YYYY-MM-DD (Bogotá calendar)
  description: string | null;
  invoiceRef: string | null;
  allocations: AllocationView[];
  createdAt: string;
  testMode: true;
};

/** POST /api/promises. */
export type CreatePromiseResponse = {
  promise: PromiseView;
  approvalUrl: string;
};

/** Payer page: GET /api/approve/[approvalToken]. */
export type ApprovalView = {
  promiseId: string; // needed for POST /api/promises/[id]/authorize
  freelancerName: string;
  amount: MoneyView;
  dueAt: string;
  description: string | null;
  invoiceRef: string | null;
  status: PromiseStatusView;
  testMode: true;
};

/** POST /api/promises/[id]/authorize. */
export type AuthorizeResponse = {
  redirectUrl: string; // the payer's wallet consent screen
};

/** Recipient page: GET /api/status/[token]. */
export type PublicStatusView = {
  label: string;
  amount: MoneyView;
  status: AllocationStatusView;
  simulated: boolean;
  freelancerName: string;
  dueAt: string;
  testMode: true;
  note: string;
};

export type ErrorResponse = {
  error: { code: string; message: string };
};
