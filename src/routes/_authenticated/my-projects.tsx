import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, Leaf, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { CarbonDisclaimer } from "@/components/CarbonDisclaimer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDate, formatNumber, formatTco2e, type ProjectStatus } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/my-projects")({
  head: () => ({
    meta: [
      { title: "My Projects · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Manage your registered blue-carbon restoration projects, track verification status and review Verified Carbon Impact in tCO₂e.",
      },
      { property: "og:title", content: "My Projects · BlueCarbon MRV Registry" },
      { property: "og:description", content: "Your registered blue-carbon restoration projects." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MyProjectsPage,
});

function MyProjectsPage() {
  const { user } = useAuth();
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["my-projects", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const verified = projects.filter((p) => p.status === "VERIFIED");
  const carbon = verified.reduce((sum, p) => sum + (p.verified_carbon ?? 0), 0);

  return (
    <AppShell
      title="My projects"
      description="Every project you have registered, with its current verification status."
      actions={
        <Link
          to="/register-project"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Register project
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Projects"
          value={projects.length}
          icon={<FolderKanban className="size-4" />}
        />
        <StatCard
          label="Verified"
          value={verified.length}
          tone="ocean"
          icon={<ShieldCheck className="size-4" />}
        />
        <StatCard
          label="Verified Carbon Impact"
          value={formatTco2e(carbon)}
          tone="teal"
          icon={<Leaf className="size-4" />}
        />
      </div>

      <div className="panel mt-6 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">Ecosystem</th>
              <th className="px-4 py-3">Area</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3">Verified Carbon Impact</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                  Loading your projects…
                </td>
              </tr>
            ) : null}
            {projects.map((p) => (
              <tr key={p.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3">
                  <Link
                    to="/verify/$code"
                    params={{ code: p.project_code }}
                    className="font-semibold text-primary"
                  >
                    {p.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{p.project_code}</span>
                </td>
                <td className="px-4 py-3">{p.ecosystem}</td>
                <td className="px-4 py-3">{formatNumber(p.area_hectares, " ha")}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={p.status as ProjectStatus} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(p.submitted_at)}</td>
                <td className="px-4 py-3">{formatTco2e(p.verified_carbon)}</td>
              </tr>
            ))}
            {!isLoading && projects.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                  You have not registered a project yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <CarbonDisclaimer className="mt-6" />
    </AppShell>
  );
}
