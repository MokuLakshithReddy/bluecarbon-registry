import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { CommunityPostCard, useCommunityUrls } from "@/components/CommunityPostCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/community-review")({
  head: () => ({
    meta: [
      { title: "Community Moderation · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "NCCR moderation workspace for community-submitted photos and videos before they appear on the public community page.",
      },
      { property: "og:title", content: "Community Moderation · BlueCarbon MRV Registry" },
      {
        property: "og:description",
        content: "Approve or reject community media submissions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CommunityReviewPage,
});

interface ReviewPost {
  id: string;
  title: string;
  body: string | null;
  media_url: string | null;
  media_type: "image" | "video";
  author_name: string;
  author_email: string | null;
  place_name: string | null;
  status: string;
  moderator_note: string | null;
  created_at: string;
}

const FILTERS = ["PENDING", "APPROVED", "REJECTED"] as const;

function CommunityReviewPage() {
  const { user, isVerifier } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("PENDING");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["community-review", filter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("community_posts")
        .select(
          "id,title,body,media_url,media_type,author_name,author_email,place_name,status,moderator_note,created_at",
        )
        .eq("status", filter)
        .order("created_at", { ascending: false })
        .limit(120);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ReviewPost[];
    },
  });

  const resolve = useCommunityUrls(posts);

  const moderate = useMutation({
    mutationFn: async (input: { id: string; status: "APPROVED" | "REJECTED" }) => {
      const { error } = await supabase
        .from("community_posts")
        .update({
          status: input.status,
          moderator_note: notes[input.id]?.trim() || null,
          moderated_by: user?.id ?? null,
          moderated_at: new Date().toISOString(),
        })
        .eq("id", input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async (_data, input) => {
      toast.success(input.status === "APPROVED" ? "Story published" : "Story rejected");
      await queryClient.invalidateQueries({ queryKey: ["community-review"] });
      await queryClient.invalidateQueries({ queryKey: ["community-feed"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not update the submission"),
  });

  if (!isVerifier) {
    return (
      <AppShell title="Community moderation">
        <p className="text-sm text-muted-foreground">
          Only NCCR verifiers can moderate community submissions.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Community moderation"
      description="Review community-submitted photos and videos. Only approved submissions appear on the public community page."
    >
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={`rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors ${
              filter === option
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:bg-secondary"
            }`}
          >
            {option === "PENDING" ? "Pending" : option === "APPROVED" ? "Published" : "Rejected"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading submissions…</p>
      ) : posts.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">Nothing in this list right now.</p>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {posts.map((post) => (
            <CommunityPostCard
              key={post.id}
              post={post}
              mediaUrl={resolve(post.media_url)}
              footer={
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{post.author_email ?? "—"}</p>
                  <Input
                    value={notes[post.id] ?? post.moderator_note ?? ""}
                    onChange={(event) =>
                      setNotes((prev) => ({ ...prev, [post.id]: event.target.value }))
                    }
                    placeholder="Reviewer note (optional)"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={moderate.isPending}
                      onClick={() => moderate.mutate({ id: post.id, status: "APPROVED" })}
                    >
                      <CheckCircle2 className="size-4" /> Publish
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={moderate.isPending}
                      onClick={() => moderate.mutate({ id: post.id, status: "REJECTED" })}
                    >
                      <XCircle className="size-4" /> Reject
                    </Button>
                  </div>
                </div>
              }
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}
