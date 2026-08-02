import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users } from "lucide-react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { SectionHeading } from "@/components/StatCard";
import { CommunityPostCard } from "@/components/CommunityPostCard";
import { getCommunityFeed } from "@/lib/community.functions";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/community")({
  head: () => ({
    meta: [
      { title: "Community Stories · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Photos, videos and field notes shared by coastal communities restoring mangroves, seagrass and salt marshes across India — reviewed by NCCR before publication.",
      },
      { property: "og:title", content: "Community Stories · BlueCarbon MRV Registry" },
      {
        property: "og:description",
        content: "Ground-level restoration stories shared by coastal communities and panchayats.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CommunityPage,
});

function CommunityPage() {
  const fetchFeed = useServerFn(getCommunityFeed);
  const { session } = useAuth();
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["community-feed"],
    queryFn: () => fetchFeed(),
  });

  return (
    <PublicLayout>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <SectionHeading
          eyebrow="Community"
          title="Restoration stories from the coast"
          description="Local communities, panchayats, SHGs and volunteers share what is happening on the ground. Every submission is reviewed by an NCCR verifier before it appears here."
        />

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to={session ? "/community-share" : "/auth"}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Users className="size-4" />
            {session ? "Share a story" : "Sign in to share a story"}
          </Link>
          <p className="text-sm text-muted-foreground">
            {posts.length} published {posts.length === 1 ? "story" : "stories"}
          </p>
        </div>

        {isLoading ? (
          <p className="mt-8 text-sm text-muted-foreground">Loading community stories…</p>
        ) : posts.length === 0 ? (
          <div className="panel mt-8 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No community stories have been published yet. Approved submissions will appear here.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <CommunityPostCard key={post.id} post={post} mediaUrl={post.media_url} />
            ))}
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
