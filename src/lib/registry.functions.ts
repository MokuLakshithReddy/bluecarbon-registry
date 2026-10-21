import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  approveProject,
  fetchPublicProject,
  fetchPublicProjects,
  rejectProject,
  requestCorrection,
  signEvidenceUrls,
  startReview,
} from "./registry.server";
import { verifyOnChainAnchor } from "./blockchain.server";

const startReviewSchema = z.object({
  projectId: z.string().uuid("Invalid project ID format"),
});

const approveSchema = z.object({
  projectId: z.string().uuid("Invalid project ID format"),
  confirmedCarbon: z
    .number({ required_error: "Confirmed carbon impact value is required" })
    .positive("Confirmed carbon impact must be a positive number")
    .max(50_000_000, "Value exceeds realistic carbon bounds"),
  comments: z.string().trim().max(4000).optional().nullable(),
});

const correctionSchema = z.object({
  projectId: z.string().uuid("Invalid project ID format"),
  comments: z
    .string({ required_error: "Comments explaining the required correction are required" })
    .trim()
    .min(5, "Comments must be at least 5 characters long")
    .max(4000),
});

const rejectSchema = z.object({
  projectId: z.string().uuid("Invalid project ID format"),
  comments: z
    .string({ required_error: "Comments explaining the rejection reason are required" })
    .trim()
    .min(5, "Comments must be at least 5 characters long")
    .max(4000),
});

const signUrlsSchema = z.object({
  urls: z.array(z.string().min(5).max(500)).max(60),
});

const verifyTxSchema = z.object({
  txHash: z.string().min(10).max(128),
  recordHash: z.string().min(10).max(128),
});

/** Public lookup for verified projects by code (PII stripped). */
export const getPublicProject = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ code: z.string().min(3).max(40) }).parse(data))
  .handler(async ({ data }) => fetchPublicProject(data.code));

/** Public lookup for all verified registry projects. */
export const getPublicProjects = createServerFn({ method: "GET" }).handler(async () =>
  fetchPublicProjects(),
);

/** Independent on-chain transaction verification. */
export const verifyOnChainTxFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => verifyTxSchema.parse(data))
  .handler(async ({ data }) => verifyOnChainAnchor(data.txHash, data.recordHash));

/** Authenticated evidence signing with ownership & authorization verification. */
export const getSignedEvidenceUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => signUrlsSchema.parse(data))
  .handler(async ({ data, context }) =>
    signEvidenceUrls(data.urls, {
      userId: context.userId,
      supabase: context.supabase,
      email: String(context.claims["email"] ?? ""),
    }),
  );

/** Moves a SUBMITTED project to UNDER_REVIEW. */
export const beginVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => startReviewSchema.parse(data))
  .handler(async ({ data, context }) =>
    startReview({
      supabase: context.supabase,
      userId: context.userId,
      verifierEmail: String(context.claims["email"] ?? "verifier"),
      projectId: data.projectId,
    }),
  );

/** Approves an UNDER_REVIEW project and anchors the verified record. */
export const approveProjectFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => approveSchema.parse(data))
  .handler(async ({ data, context }) =>
    approveProject({
      supabase: context.supabase,
      userId: context.userId,
      verifierEmail: String(context.claims["email"] ?? "verifier"),
      projectId: data.projectId,
      comments: data.comments ?? null,
      confirmedCarbon: data.confirmedCarbon,
    }),
  );

/** Requests corrections from the project owner. */
export const requestCorrectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => correctionSchema.parse(data))
  .handler(async ({ data, context }) =>
    requestCorrection({
      supabase: context.supabase,
      userId: context.userId,
      verifierEmail: String(context.claims["email"] ?? "verifier"),
      projectId: data.projectId,
      comments: data.comments,
    }),
  );

/** Rejects a project submission. */
export const rejectProjectFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => rejectSchema.parse(data))
  .handler(async ({ data, context }) =>
    rejectProject({
      supabase: context.supabase,
      userId: context.userId,
      verifierEmail: String(context.claims["email"] ?? "verifier"),
      projectId: data.projectId,
      comments: data.comments,
    }),
  );
