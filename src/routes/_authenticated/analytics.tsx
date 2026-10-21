import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { CarbonDisclaimer } from "@/components/CarbonDisclaimer";
import { useAllProjects } from "./verifier";
import { ECOSYSTEM_LABEL, formatNumber, formatTco2e, type Ecosystem } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({
    meta: [
      { title: "Registry Analytics · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Aggregate blue-carbon analytics: restored hectares, Verified Carbon Impact by ecosystem and verification throughput by state.",
      },
      { property: "og:title", content: "Registry Analytics · BlueCarbon MRV Registry" },
      { property: "og:description", content: "Aggregate restoration and verification analytics." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { data: projects = [] } = useAllProjects();
  const verified = projects.filter((p) => p.status === "VERIFIED");
  const area = projects.reduce((s, p) => s + (p.area_hectares ?? 0), 0);
  const carbon = verified.reduce((s, p) => s + (p.verified_carbon ?? 0), 0);

  const byEcosystem = new Map<string, { area: number; carbon: number; count: number }>();
  for (const p of projects) {
    const key = p.ecosystem;
    const entry = byEcosystem.get(key) ?? { area: 0, carbon: 0, count: 0 };
    entry.area += p.area_hectares ?? 0;
    entry.carbon += p.verified_carbon ?? 0;
    entry.count += 1;
    byEcosystem.set(key, entry);
  }

  const byState = new Map<string, number>();
  for (const p of projects) {
    const key = p.state ?? "Unspecified";
    byState.set(key, (byState.get(key) ?? 0) + 1);
  }
  const maxState = Math.max(1, ...byState.values());

  return (
    <AppShell
      title="Registry analytics"
      description="Aggregate view of restoration extent and verification outcomes."
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Projects" value={projects.length} />
        <StatCard label="Verified projects" value={verified.length} tone="ocean" />
        <StatCard label="Area under restoration" value={formatNumber(area, " ha")} tone="leaf" />
        <StatCard label="Verified Carbon Impact" value={formatTco2e(carbon)} tone="teal" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            By ecosystem
          </p>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {[...byEcosystem.entries()].map(([key, value]) => (
                <tr key={key} className="border-b border-border/60 last:border-0">
                  <td className="py-2 font-medium">{ECOSYSTEM_LABEL[key as Ecosystem] ?? key}</td>
                  <td className="py-2 text-muted-foreground">{value.count} projects</td>
                  <td className="py-2 text-muted-foreground">{formatNumber(value.area, " ha")}</td>
                  <td className="py-2 text-right">{formatTco2e(value.carbon)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Projects by state
          </p>
          <ul className="mt-3 space-y-2.5">
            {[...byState.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([state, count]) => (
                <li key={state}>
                  <div className="flex justify-between text-sm">
                    <span>{state}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-teal"
                      style={{ width: `${(count / maxState) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
          </ul>
        </div>
      </div>

      <CarbonDisclaimer className="mt-6" />
    </AppShell>
  );
}
