import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCheck } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Verification decisions, correction requests and registry updates for your blue-carbon restoration projects.",
      },
      { property: "og:title", content: "Notifications · BlueCarbon MRV Registry" },
      { property: "og:description", content: "Registry and verification updates." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["notifications", user?.email],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const markAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("recipient_email", user?.email ?? "")
        .eq("read", false);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["unread-notifications"] });
    },
  });

  return (
    <AppShell
      title="Notifications"
      description="Status changes and verifier messages relating to projects you can access."
      actions={
        <Button variant="outline" size="sm" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
          <CheckCheck className="size-4" /> Mark all read
        </Button>
      }
    >
      <div className="panel divide-y divide-border">
        {isLoading ? <p className="p-5 text-sm text-muted-foreground">Loading notifications…</p> : null}
        {items.map((item) => (
          <article key={item.id} className="flex gap-3 p-4">
            <span
              className={`mt-1 flex size-8 shrink-0 items-center justify-center rounded-full ${
                item.read ? "bg-muted text-muted-foreground" : "bg-teal/12 text-teal"
              }`}
            >
              <BellRing className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{item.title}</p>
              {item.body ? <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p> : null}
              <p className="mt-1 text-xs text-muted-foreground">{formatDate(item.created_at)}</p>
            </div>
          </article>
        ))}
        {!isLoading && items.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">You have no notifications yet.</p>
        ) : null}
      </div>
    </AppShell>
  );
}
