// Response DTOs shared with the frontend. These must NEVER contain grant
// tokens, nonces, continue/manage URIs, the approval token or the freelancer
// key (the create response carries approvalUrl/freelancerKey/dashboardUrl, once).
// Open Payments resource URLs appear ONLY in the records pack.

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

/** D9 payment steps. */
export type PaymentStepView = "created" | "incoming_created" | "quoted" | "submitted" | "completed" | "failed";

export type AtRiskReasonView = "simulated_revocation" | "grant_revoked" | "rotation_failed";

/** Latest payment attempt for an allocation (freelancer view). */
export type PaymentView = {
  attempt: number;
  step: PaymentStepView;
  debit: MoneyView | null; // charged to the payer (payer asset)
  receive: MoneyView | null; // quoted to the recipient (recipient asset)
  error: string | null; // safe message, no secrets
  createdAt: string;
  completedAt: string | null;
};

export type AllocationView = {
  id: string;
  label: string;
  recipientWallet: string;
  amount: MoneyView;
  status: AllocationStatusView;
  simulated: boolean;
  statusUrl: string; // public read-only page for this recipient
  payment: PaymentView | null;
};

/** Freelancer view: GET /api/promises/[id] (requires x-freelancer-key). */
export type PromiseView = {
  id: string;
  status: PromiseStatusView;
  atRisk: { reason: AtRiskReasonView; simulated: boolean } | null;
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

/** POST /api/promises. The only response that carries the secrets the freelancer must keep. */
export type CreatePromiseResponse = {
  promise: PromiseView;
  approvalUrl: string; // send to the payer
  freelancerKey: string; // send as x-freelancer-key; shown once
  dashboardUrl: string; // `${APP_BASE_URL}/dashboard/${id}#k=${freelancerKey}`
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
  /** true when the promise is at_risk for a real reason and the payer can approve again. */
  reapprovalNeeded: boolean;
  testMode: true;
};

/** POST /api/promises/[id]/authorize. */
export type AuthorizeResponse = {
  redirectUrl: string; // the payer's wallet consent screen
};

/** POST /api/promises/[id]/execute → 202. Poll GET /api/promises/[id]. */
export type ExecuteResponse = { status: "executing" };

/** Recipient page: GET /api/status/[token]. */
export type PublicStatusView = {
  label: string;
  amount: MoneyView;
  status: AllocationStatusView;
  simulated: boolean;
  freelancerName: string;
  dueAt: string;
  payment: { step: PaymentStepView; recipientAmount: MoneyView | null; completedAt: string | null } | null;
  testMode: true;
  note: string;
};

export type TimelineEntry = { type: string; at: string; summary: string };

/** GET /api/promises/[id]/events. */
export type EventsResponse = { events: TimelineEntry[] };

/** GET /api/promises/[id]/records (downloadable JSON). */
export type RecordsPack = {
  kind: "alive.records-pack";
  version: 1;
  generatedAt: string;
  testMode: true;
  disclaimer: string;
  promise: {
    id: string;
    status: PromiseStatusView;
    freelancer: { wallet: string; name: string };
    payerWallet: string | null;
    amount: MoneyView;
    dueAt: string;
    description: string | null;
    invoiceRef: string | null;
    createdAt: string;
  };
  allocations: {
    id: string;
    label: string;
    recipientWallet: string;
    amount: MoneyView;
    status: AllocationStatusView;
    simulated: boolean;
  }[];
  payments: {
    id: string;
    allocationId: string;
    label: string;
    attempt: number;
    step: PaymentStepView;
    debit: MoneyView | null;
    receive: MoneyView | null;
    incomingPaymentUrl: string | null; // Open Payments resource (evidence for the accountant)
    outgoingPaymentUrl: string | null;
    error: string | null;
    createdAt: string;
    completedAt: string | null;
  }[];
  events: TimelineEntry[];
};

export type ErrorResponse = {
  error: { code: string; message: string };
};
