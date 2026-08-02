import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchApprovedCommunityPosts, signCommunityUrls } from "./community.server";

export const getCommunityFeed = createServerFn({ method: "GET" }).handler(async () =>
  fetchApprovedCommunityPosts(),
);

export const getSignedCommunityUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ urls: z.array(z.string()).max(80) }).parse(data))
  .handler(async ({ data }) => signCommunityUrls(data.urls));
