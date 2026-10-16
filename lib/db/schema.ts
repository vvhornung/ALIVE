// ALIVE schema: AGENTS.md §7 + ARCHITECTURE-BACKEND.md §3, inlined so nothing
// depends on process.cwd(). Bump SCHEMA_VERSION whenever this changes.
// Columns marked (enc) hold AES-256-GCM ciphertext from lib/crypto.ts.

export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS promises (
  id TEXT PRIMARY KEY,                       -- uuid
  freelancer_wallet TEXT NOT NULL,           -- wallet address URL
  freelancer_name TEXT NOT NULL,
  payer_wallet TEXT,                         -- set at authorize
  asset_code TEXT NOT NULL,                  -- payer debit asset (D3)
  asset_scale INTEGER NOT NULL,
  total_value TEXT NOT NULL,                 -- integer string, minor units
  due_at TEXT NOT NULL,                      -- YYYY-MM-DD
  description TEXT,
  invoice_ref TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'draft', 'awaiting_approval', 'active', 'executing',
    'completed', 'partially_failed', 'at_risk', 'expired'
  )),
  approval_token TEXT NOT NULL UNIQUE,       -- public approval link (not the id)
  freelancer_key_hash TEXT NOT NULL,         -- sha256 hex of the freelancer key (key itself never stored)
  at_risk_reason TEXT CHECK (at_risk_reason IN ('simulated_revocation', 'grant_revoked', 'rotation_failed')),
  grant_continue_uri TEXT,                   -- (enc)
  grant_continue_token TEXT,                 -- (enc)
  grant_client_nonce TEXT,                   -- (enc) D5
  grant_finish_nonce TEXT,                   -- (enc) D5
  grant_access_token TEXT,                   -- (enc)
  grant_manage_uri TEXT,                     -- (enc)
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS allocations (
  id TEXT PRIMARY KEY,
  promise_id TEXT NOT NULL REFERENCES promises(id),
  label TEXT NOT NULL,                       -- 'PILA', 'Rent', 'Designer', 'Me'
  recipient_wallet TEXT NOT NULL,
  value TEXT NOT NULL,                       -- integer string, promise asset
  status TEXT NOT NULL CHECK (status IN ('pending', 'paying', 'paid', 'failed')),
  status_token TEXT NOT NULL UNIQUE,         -- random, public status page
  simulated INTEGER NOT NULL DEFAULT 0       -- 1 = simulated party (PILA fund)
);

-- D9: step is the payment state machine; status mirrors step (kept for AGENTS §7 compatibility).
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  allocation_id TEXT NOT NULL REFERENCES allocations(id),
  idempotency_key TEXT NOT NULL UNIQUE,      -- promiseId:allocationId:attempt
  attempt INTEGER NOT NULL DEFAULT 1,
  step TEXT NOT NULL CHECK (step IN ('created', 'incoming_created', 'quoted', 'submitted', 'completed', 'failed')),
  incoming_payment_url TEXT,
  quote_id TEXT,                             -- quote URL (Open Payments ids are URLs)
  outgoing_payment_url TEXT,
  debit_value TEXT,
  receive_value TEXT,
  receive_asset_code TEXT,
  receive_asset_scale INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS events (          -- append-only audit log
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promise_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,                              -- JSON; never tokens or nonces
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_allocations_promise_id ON allocations(promise_id);
CREATE INDEX IF NOT EXISTS idx_payments_allocation_id ON payments(allocation_id);
CREATE INDEX IF NOT EXISTS idx_events_promise_id ON events(promise_id);
`;
