// Request body schemas. Amounts are decimal STRINGS ("12.50"); JSON numbers
// are rejected so money never passes through a float.
import { z } from "zod";

const walletAddress = z.string().trim().min(1).max(2048);
const decimalAmount = z.string({ error: "must be a decimal string like \"12.50\"" }).trim().min(1).max(40);

export const createPromiseSchema = z.object({
  freelancerWallet: walletAddress,
  freelancerName: z.string().trim().max(100).optional(),
  amount: decimalAmount,
  assetCode: z.string().trim().toUpperCase().length(3),
  assetScale: z.number().int().min(0).max(18).optional(),
  dueAt: z.string().trim(),
  description: z.string().trim().max(500).optional(),
  invoiceRef: z.string().trim().max(100).optional(),
});

export const authorizeSchema = z.object({
  approvalToken: z.string().trim().min(1).max(200),
  payerWallet: walletAddress,
});

export const revokeSimSchema = z.object({
  revoked: z.boolean(),
});

export const allocationsSchema = z.object({
  allocations: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        recipientWallet: walletAddress,
        amount: decimalAmount,
        simulated: z.boolean().optional(),
      }),
    )
    .max(20),
});
