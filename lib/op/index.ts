// Public entry point of the Open Payments wrapper for the Next.js app.
// The app imports ONLY from "@/lib/op"; this guard makes the build fail if a
// client component pulls it in. The files themselves are unguarded so the
// spike scripts (plain Node via tsx) can import them directly.
import "server-only";

export * from "./client";
export * from "./errors";
export * from "./grants";
export * from "./incoming";
export * from "./outgoing";
export * from "./quote";
export * from "./wallet";
