// Validated server environment. Parsed lazily on first use so `next build`
// does not require secrets; fails fast with the names of the bad variables.
import { z } from "zod";

// Empty strings (as in .env.example) count as "not set".
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
const requiredString = z.preprocess((v) => (v === "" ? undefined : v), z.string({ error: "is required" }));

const httpsUrl = requiredString
  .transform((v) => v.trim().replace(/^\$/, "https://"))
  .pipe(z.url({ protocol: /^https$/, error: "must be an https:// wallet address" }));

const encryptionKey = optionalString.refine(
  (v) => v === undefined || Buffer.from(v, "base64").length === 32,
  "must be 32 random bytes encoded as base64",
);

const schema = z.object({
  OP_WALLET_ADDRESS_URL: httpsUrl,
  OP_KEY_ID: requiredString,
  OP_PRIVATE_KEY: optionalString,
  OP_PRIVATE_KEY_B64: optionalString,
  APP_BASE_URL: z.preprocess(
    (v) => (v === "" || v === undefined ? "http://localhost:3000" : v),
    z.url({ error: "must be a URL" }),
  ),
  ENCRYPTION_KEY: encryptionKey,
  STRICT_HASH: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["true", "false"]).default("false")),
});

export type Env = {
  opWalletAddressUrl: string;
  opKeyId: string;
  /** File path or PEM text, as accepted by createAuthenticatedClient. */
  opPrivateKey: string;
  appBaseUrl: string;
  encryptionKey: string | undefined;
  strictHash: boolean;
};

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

/** Pure parser (no caching), exported for tests. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  const lines = parsed.success
    ? []
    : parsed.error.issues.map((i) => `  - ${i.path.join(".") || "env"}: ${i.message}`);
  // Checked separately so it is reported together with any other problem.
  const privateKey = source.OP_PRIVATE_KEY_B64
    ? Buffer.from(source.OP_PRIVATE_KEY_B64, "base64").toString("utf8")
    : source.OP_PRIVATE_KEY;
  if (!privateKey) {
    lines.push("  - OP_PRIVATE_KEY / OP_PRIVATE_KEY_B64: set one (file path or PEM, or PEM as base64)");
  }
  if (!parsed.success || !privateKey) {
    throw new EnvError(`Invalid environment (check .env.local against .env.example):\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  return {
    opWalletAddressUrl: e.OP_WALLET_ADDRESS_URL,
    opKeyId: e.OP_KEY_ID,
    opPrivateKey: privateKey,
    appBaseUrl: e.APP_BASE_URL.replace(/\/+$/, ""),
    encryptionKey: e.ENCRYPTION_KEY,
    strictHash: e.STRICT_HASH === "true",
  };
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
