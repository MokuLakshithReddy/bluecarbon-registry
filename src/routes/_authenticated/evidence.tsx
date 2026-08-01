import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { EvidenceGallery } from "@/components/EvidenceGallery";
import { supabase } from "@/integrations/supabase/client";
import type { EvidenceRow } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/evidence")({
  head: () => ({
    meta: [
      { title: "Field Evidence · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Browse geotagged field evidence — drone imagery, ground photos, survey sheets and sensor logs — submitted for blue-carbon restoration projects.",
      },
      { property: "og:title", content: "Field Evidence · BlueCarbon MRV Registry" },
      { property: "og:description", content: "Geotagged evidence submitted for MRV verification." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EvidencePage,
});

function EvidencePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["evidence-all"],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("evidence")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(120);
      if (error) throw new Error(error.message);
      return (rows ?? []) as unknown as EvidenceRow[];
    },
  });

  return (
    <AppShell
      title="Field evidence"
      description="Every evidence item you can access, newest first. Files are served through short-lived signed links."
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading evidence…</p>
      ) : (
        <EvidenceGallery items={data ?? []} emptyLabel="No evidence has been uploaded yet." />
      )}
    </AppShell>
  );
}
