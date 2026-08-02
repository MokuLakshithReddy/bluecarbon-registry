import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDate, formatTco2e } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/marketplace-interests")({
  head: () => ({
    meta: [
      { title: "Marketplace Interest · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Corporate expressions of interest registered against NCCR-verified blue-carbon restoration projects.",
      },
      { property: "og:title", content: "Marketplace Interest · BlueCarbon MRV Registry" },
      {
        property: "og:description",
        content: "Track and triage corporate enquiries for verified restoration projects.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketplaceInterestsPage,
});

const STATUSES = ["NEW", "IN_DISCUSSION", "CLOSED", "DECLINED"] as const;

interface InterestRow {
  id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  requested_tco2e: number | null;
  intended_use: string | null;
  message: string | null;
  status: string;
  created_at: string;
  projects: { project_code: string; name: string } | null;
}

function MarketplaceInterestsPage() {
  const { isVerifier } = useAuth();
  const queryClient = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["marketplace-interests"],
    enabled: isVerifier,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketplace_interests")
        .select(
          "id,company_name,contact_name,contact_email,contact_phone,requested_tco2e,intended_use,message,status,created_at,projects(project_code,name)",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as InterestRow[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async (input: { id: string; status: string }) => {
      const { error } = await supabase
        .from("marketplace_interests")
        .update({ status: input.status })
        .eq("id", input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Enquiry updated");
      await queryClient.invalidateQueries({ queryKey: ["marketplace-interests"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not update the enquiry"),
  });

  if (!isVerifier) {
    return (
      <AppShell title="Marketplace interest">
        <p className="text-sm text-muted-foreground">
          Only NCCR verifiers can view corporate enquiries.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Marketplace interest"
      description="Non-binding corporate enquiries against verified projects. The registry does not issue, sell or transfer carbon credits."
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading enquiries…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No expressions of interest yet.</p>
      ) : (
        <div className="panel divide-y divide-border">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="font-display font-semibold">{row.company_name}</p>
                <p className="text-xs text-muted-foreground">
                  {row.projects ? `${row.projects.project_code} · ${row.projects.name}` : "—"}
                </p>
                <p className="mt-1 text-sm">
                  {row.contact_name} · {row.contact_email}
                  {row.contact_phone ? ` · ${row.contact_phone}` : ""}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Interest: {formatTco2e(row.requested_tco2e)}
                  {row.intended_use ? ` · ${row.intended_use}` : ""}
                </p>
                {row.message ? (
                  <p className="mt-1 max-w-xl text-sm text-muted-foreground">{row.message}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(row.created_at)}</p>
              </div>
              <select
                value={row.status}
                aria-label={`Status for ${row.company_name}`}
                onChange={(event) => setStatus.mutate({ id: row.id, status: event.target.value })}
                className="h-9 rounded-lg border border-border bg-card px-3 text-sm"
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
