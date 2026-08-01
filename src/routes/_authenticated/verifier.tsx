import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Leaf, ShieldCheck, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { CarbonDisclaimer } from "@/components/CarbonDisclaimer";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, formatNumber, formatTco2e, type ProjectStatus } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/verifier")({
  head: () => ({
    meta: [
      { title: "Verifier Dashboard · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "NCCR verifier workspace: pending submissions, projects under review and confirmed Verified Carbon Impact across the blue-carbon registry.",
      },
      { property: "og:title", content: "Verifier Dashboard · BlueCarbon MRV Registry" },
      { property: "og:description", content: "NCCR verification workload at a glance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VerifierDashboard,
});

export function useAllProjects() {
  return useQuery({
    queryKey: ["registry-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("submitted_at", { ascending: false, nullsFirst: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

function VerifierDashboard() {
  const { data: projects = [], isLoading } = useAllProjects();

  const submitted = projects.filter((p) => p.status === "SUBMITTED");
  const underReview = projects.filter((p) => p.status === "UNDER_REVIEW");
  const corrections = projects.filter((p) => p.status === "CORRECTION_REQUIRED");
  const verified = projects.filter((p) => p.status === "VERIFIED");
  const carbon = verified.reduce((sum, p) => sum + (p.verified_carbon ?? 0), 0);

  const recent = projects.slice(0, 8);

  return (
    <AppShell
      title="Verification overview"
      description="Workload across all coastal restoration submissions in the registry."
      actions={
        <Link
          to="/queue"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Open queue
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Awaiting first review"
          value={submitted.length}
          icon={<ClipboardCheck className="size-4" />}
        />
        <StatCard label="Under review" value={underReview.length} tone="ocean" />
        <StatCard
          label="Correction requested"
          value={corrections.length}
          tone="warning"
          icon={<TriangleAlert className="size-4" />}
        />
        <StatCard
          label="Verified Carbon Impact"
          value={formatTco2e(carbon)}
          tone="teal"
          icon={<Leaf className="size-4" />}
        />
      </div>

      <div className="panel mt-6 overflow-x-auto">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <ShieldCheck className="size-4 text-teal" />
          <p className="text-sm font-semibold">Latest submissions</p>
        </div>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Area</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                  Loading registry…
                </td>
              </tr>
            ) : null}
            {recent.map((p) => (
              <tr key={p.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-semibold">
                  {p.name}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {p.project_code}
                  </span>
                </td>
                <td className="px-4 py-3">{p.state ?? "—"}</td>
                <td className="px-4 py-3">{formatNumber(p.area_hectares, " ha")}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={p.status as ProjectStatus} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(p.submitted_at)}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to="/review/$id"
                    params={{ id: p.id }}
                    className="text-sm font-semibold text-primary hover:underline"
                  >
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CarbonDisclaimer className="mt-6" />
    </AppShell>
  );
}
