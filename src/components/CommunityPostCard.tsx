import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Image as ImageIcon, MapPin, Video } from "lucide-react";
import { getSignedCommunityUrls } from "@/lib/community.functions";
import { formatDate } from "@/lib/domain";
import type { PublicCommunityPost } from "@/lib/community-types";

const STORAGE_PREFIX = "storage://";

/** Resolves private community media paths into short-lived signed URLs. */
export function useCommunityUrls(items: { media_url: string | null }[]) {
  const sign = useServerFn(getSignedCommunityUrls);
  const urls = useMemo(
    () =>
      items.map((i) => i.media_url).filter((u): u is string => !!u && u.startsWith(STORAGE_PREFIX)),
    [items],
  );
  const { data } = useQuery({
    queryKey: ["community-urls", urls],
    queryFn: () => sign({ data: { urls } }),
    enabled: urls.length > 0,
    staleTime: 30 * 60 * 1000,
  });
  return (raw: string | null | undefined) => {
    if (!raw) return null;
    if (!raw.startsWith(STORAGE_PREFIX)) return raw;
    return (data as Record<string, string | null> | undefined)?.[raw] ?? null;
  };
}

export function CommunityMedia({
  url,
  type,
  title,
}: {
  url: string | null;
  type: "image" | "video";
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-border bg-secondary text-xs text-muted-foreground">
        {type === "video" ? <Video className="size-5" /> : <ImageIcon className="size-5" />}
      </div>
    );
  }
  if (type === "video") {
    return (
      <video
        controls
        preload="metadata"
        src={url}
        className="aspect-video w-full rounded-lg bg-black object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <img
      src={url}
      alt={title}
      loading="lazy"
      className="aspect-video w-full rounded-lg object-cover"
      onError={() => setFailed(true)}
    />
  );
}

export function CommunityPostCard({
  post,
  mediaUrl,
  footer,
}: {
  post: Pick<
    PublicCommunityPost,
    "title" | "body" | "media_type" | "author_name" | "place_name" | "created_at"
  >;
  mediaUrl: string | null;
  footer?: React.ReactNode;
}) {
  return (
    <article className="panel flex flex-col gap-3 p-4">
      <CommunityMedia url={mediaUrl} type={post.media_type} title={post.title} />
      <div>
        <h3 className="font-display text-base font-semibold leading-snug">{post.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {post.author_name} · {formatDate(post.created_at)}
        </p>
      </div>
      {post.body ? <p className="text-sm text-muted-foreground">{post.body}</p> : null}
      {post.place_name ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3.5" /> {post.place_name}
        </p>
      ) : null}
      {footer}
    </article>
  );
}
