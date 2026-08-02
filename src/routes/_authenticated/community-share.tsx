import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { CommunityPostCard, useCommunityUrls } from "@/components/CommunityPostCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/community-share")({
  head: () => ({
    meta: [
      { title: "Share a Community Story · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Upload photos, videos and field notes from your restoration site. NCCR verifiers review each submission before it is published to the public community page.",
      },
      { property: "og:title", content: "Share a Community Story · BlueCarbon MRV Registry" },
      {
        property: "og:description",
        content: "Community media submissions for blue-carbon restoration sites.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CommunitySharePage,
});

const MAX_BYTES = 40 * 1024 * 1024;
const STATUS_TONE: Record<string, string> = {
  PENDING: "bg-warning/12 text-warning",
  APPROVED: "bg-success/12 text-success",
  REJECTED: "bg-destructive/10 text-destructive",
};

interface MyPost {
  id: string;
  title: string;
  body: string | null;
  media_url: string | null;
  media_type: "image" | "video";
  author_name: string;
  place_name: string | null;
  status: string;
  moderator_note: string | null;
  created_at: string;
}

function CommunitySharePage() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [place, setPlace] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const { data: myPosts = [], isLoading } = useQuery({
    queryKey: ["my-community-posts", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("community_posts")
        .select(
          "id,title,body,media_url,media_type,author_name,place_name,status,moderator_note,created_at",
        )
        .eq("author_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as MyPost[];
    },
  });

  const resolve = useCommunityUrls(myPosts);

  const submit = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("You must be signed in to share a story.");
      if (title.trim().length < 3) throw new Error("Please add a short title (3+ characters).");
      if (!file) throw new Error("Please attach a photo or video.");
      if (file.size > MAX_BYTES) throw new Error("Files must be 40 MB or smaller.");
      const isVideo = file.type.startsWith("video/");
      if (!isVideo && !file.type.startsWith("image/"))
        throw new Error("Only image or video files can be shared.");

      const extension = file.name.split(".").pop()?.toLowerCase() ?? (isVideo ? "mp4" : "jpg");
      const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("community")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const { error } = await supabase.from("community_posts").insert({
        author_id: user.id,
        author_name: profile?.full_name || profile?.email || user.email || "Community member",
        author_email: profile?.email ?? user.email ?? null,
        title: title.trim(),
        body: body.trim() ? body.trim() : null,
        place_name: place.trim() ? place.trim() : null,
        media_url: `storage://${path}`,
        media_type: isVideo ? "video" : "image",
        status: "PENDING",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Story submitted — an NCCR verifier will review it before publication.");
      setTitle("");
      setBody("");
      setPlace("");
      setFile(null);
      await queryClient.invalidateQueries({ queryKey: ["my-community-posts"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not submit your story"),
  });

  return (
    <AppShell
      title="Share a community story"
      description="Upload ground-level photos and videos from your restoration site. Submissions are published after NCCR review."
      actions={
        <Link
          to="/community"
          className="rounded-lg border border-border px-3.5 py-2 text-sm font-semibold hover:bg-secondary"
        >
          View public feed
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <form
          className="panel space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="community-title">Title</Label>
            <Input
              id="community-title"
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Mangrove saplings planted at Kannur creek"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="community-body">Story (optional)</Label>
            <Textarea
              id="community-body"
              value={body}
              maxLength={4000}
              rows={5}
              onChange={(event) => setBody(event.target.value)}
              placeholder="What did the community do, when, and how many people took part?"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="community-place">Place (optional)</Label>
            <Input
              id="community-place"
              value={place}
              maxLength={160}
              onChange={(event) => setPlace(event.target.value)}
              placeholder="Village, district, state"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="community-file">Photo or video</Label>
            <Input
              id="community-file"
              type="file"
              accept="image/*,video/mp4,video/webm,video/quicktime"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">Up to 40 MB per file.</p>
          </div>
          <Button type="submit" disabled={submit.isPending} className="w-full">
            {submit.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            Submit for review
          </Button>
        </form>

        <section>
          <h2 className="font-display text-lg font-semibold">Your submissions</h2>
          {isLoading ? (
            <p className="mt-3 text-sm text-muted-foreground">Loading your submissions…</p>
          ) : myPosts.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              You have not shared anything yet. Your first submission will appear here.
            </p>
          ) : (
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              {myPosts.map((post) => (
                <CommunityPostCard
                  key={post.id}
                  post={post}
                  mediaUrl={resolve(post.media_url)}
                  footer={
                    <div className="space-y-1.5">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-wider ${
                          STATUS_TONE[post.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {post.status === "PENDING" ? "Pending NCCR review" : post.status}
                      </span>
                      {post.moderator_note ? (
                        <p className="text-xs text-muted-foreground">
                          Reviewer note: {post.moderator_note}
                        </p>
                      ) : null}
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
