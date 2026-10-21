/**
 * Server-only helpers for the community stories feed. Community media lives in a
 * private bucket, so URLs are signed on the server before being sent to clients.
 */
import { publicServerClient } from "./registry.server.ts";
import type { PublicCommunityPost } from "./community-types.ts";

const STORAGE_PREFIX = "storage://";

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const COMMUNITY_STORAGE_REGEX = /^storage:\/\/community\/([0-9a-fA-F-]{36})\/(.+)$/;

export async function signCommunityUrls(urls: string[], requestingUserId?: string) {
  const admin = await getAdmin();
  const out: Record<string, string | null> = {};
  if (!urls || urls.length === 0) return out;

  const validUrls: string[] = [];
  for (const url of urls) {
    if (!url || typeof url !== "string") {
      out[url] = null;
      continue;
    }
    const match = url.match(COMMUNITY_STORAGE_REGEX);
    if (!match) {
      // SECURITY: Reject non-storage and external arbitrary URLs
      out[url] = null;
      continue;
    }
    validUrls.push(url);
  }

  if (validUrls.length === 0) return out;

  // Resolve each requested media URL against actual community_posts database records
  const { data: posts, error } = await admin
    .from("community_posts")
    .select("media_url, status, author_id")
    .in("media_url", validUrls);

  const postMap = new Map<string, { status: string; author_id: string }>();
  if (!error && posts) {
    for (const post of posts) {
      if (post.media_url) {
        postMap.set(post.media_url, { status: post.status, author_id: post.author_id });
      }
    }
  }

  for (const url of validUrls) {
    const post = postMap.get(url);
    // Authorization check: media can only be signed if post is APPROVED,
    // or if the authenticated requester is the post's author.
    const isApproved = post?.status === "APPROVED";
    const isAuthor = Boolean(requestingUserId && post?.author_id === requestingUserId);

    if (!isApproved && !isAuthor) {
      out[url] = null;
      continue;
    }

    const match = url.match(COMMUNITY_STORAGE_REGEX)!;
    const path = `${match[1]}/${match[2]}`;
    // Short-lived signed URLs (15 minutes)
    const { data, error: signErr } = await admin.storage
      .from("community")
      .createSignedUrl(path, 15 * 60);
    out[url] = signErr ? null : (data?.signedUrl ?? null);
  }

  return out;
}

/** Approved community posts only — enforced by the public row-level policy. */
export async function fetchApprovedCommunityPosts(limit = 60): Promise<PublicCommunityPost[]> {
  const client = publicServerClient();
  const { data, error } = await client
    .from("community_posts")
    .select(
      "id,title,body,media_url,media_type,author_name,place_name,latitude,longitude,project_id,created_at",
    )
    .eq("status", "APPROVED")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const posts = (data ?? []).map((row) => ({
    ...row,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    media_type: row.media_type === "video" ? "video" : "image",
  })) as PublicCommunityPost[];

  const signed = await signCommunityUrls(
    posts.map((p) => p.media_url).filter((u): u is string => !!u),
  );
  for (const post of posts) {
    if (post.media_url) post.media_url = signed[post.media_url] ?? null;
  }
  return posts;
}
