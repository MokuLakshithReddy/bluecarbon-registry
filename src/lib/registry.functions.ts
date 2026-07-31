import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  approveProject,
  ensureDemoAccounts,
  fetchPublicProject,
  fetchPublicProjects,
  rejectProject,
  requestCorrection,
  signEvidenceUrls,
  startReview,
} from "./registry.server";

const decisionSchema = z.object({
  projectId: z.string().uuid(),
  comments: z.string().optional().nullable(),
  confirmedCarbon: z.number().optional().nullable(),
});

export const provisionDemoAccounts = createServerFn({ method: "POST" }).handler(async () =>
  ensureDemoAccounts(),
);

export const getPublicProject = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ code: z.string().min(3).max(40) }).parse(data))
  .handler(async ({ data }) => fetchPublicProject(data.code));

export const getPublicProjects = createServerFn({ method: "GET" }).handler(async () =>
  fetchPublicProjects(),
);

export const getSignedEvidenceUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ urls: z.array(z.string()).max(60) }).parse(data))
  .handler(async ({ data }) => signEvidenceUrls(data.urls));

export const beginVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => decisionSchema.parse(data))
  .handler(async ({ data, context }) =>
    startReview({
      supabase: context.supabase,
      userId: context.userId,
      verifierEmail: String(context.claims["email"] ?? "verifier"),
      projectId: data.projectId,
    }),
  );

export const approveProjectFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => decisionSchema.parse(data))
  .handler(async ({ data, context }) =>
    approveProject({
      supabase: context.supabase,
      userId: context.userId,
      verifierEmail: String(context.claims["email"] ?? "verifier"),
      projectId: data.projectId,
      comments: data.comments ?? null,
      confirmedCarbon: data.confirmedCarbon ?? null,
    }),
  );

export const requestCorrectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => decisionSchema.parse(data))
  .handler(async ({ data, context }) =>
    requestCorrection({
      supabase: context.supabase,
      userId: context.userId,
      verifierEmail: String(context.claims["email"] ?? "verifier"),
      projectId: data.projectId,
      comments: data.comments ?? null,
    }),
  );

export const rejectProjectFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => decisionSchema.parse(data))
  .handler(async ({ data, context }) =>
    rejectProject({
      supabase: context.supabase,
      userId: context.userId,
      verifierEmail: String(context.claims["email"] ?? "verifier"),
      projectId: data.projectId,
      comments: data.comments ?? null,
    }),
  );
