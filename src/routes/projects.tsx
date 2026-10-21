import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { SectionHeading } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { CarbonDisclaimer } from "@/components/CarbonDisclaimer";
import { getPublicProjects } from "@/lib/registry.functions";
import {
  ECOSYSTEM_LABEL,
  ECOSYSTEM_OPTIONS,
  formatDate,
  formatNumber,
  formatTco2e,
  type Ecosystem,
  type ProjectStatus,
} from "@/lib/domain";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "Registered Projects · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Browse blue-carbon restoration projects registered with the MRV registry, their ecosystems, restoration area and Verified Carbon Impact in tCO₂e.",
      },
      { property: "og:title", content: "Registered Projects · BlueCarbon MRV Registry" },
      {
        property: "og:description",
        content: "Public list of mangrove, seagrass and coastal wetland restoration projects.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const fetchProjects = useServerFn(getPublicProjects);
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["public-projects"],
    queryFn: () => fetchProjects(),
  });
  const [query, setQuery] = useState("");
  const [ecosystem, setEcosystem] = useState<string>("ALL");

  const filtered = projects.filter((p) => {
    const matchesQuery = `${p.name} ${p.project_code} ${p.state ?? ""} ${p.district ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    const matchesEcosystem = ecosystem === "ALL" || p.ecosystem === ecosystem;
    return matchesQuery && matchesEcosystem;
  });

  return (
    <PublicLayout>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <SectionHeading
          eyebrow="Public registry"
          title="Registered blue-carbon projects"
          description="Search the registry by project name, code, state or district. Verified entries link to a publicly provable record."
        />

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects…"
            className="max-w-xs"
            aria-label="Search projects"
          />
          <select
            value={ecosystem}
            onChange={(event) => setEcosystem(event.target.value)}
            aria-label="Filter by ecosystem"
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="ALL">All ecosystems</option>
            {ECOSYSTEM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {ECOSYSTEM_LABEL[option]}
              </option>
            ))}
          </select>
          <p className="text-sm text-muted-foreground">{filtered.length} projects</p>
        </div>

        <div className="panel mt-6 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Ecosystem</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Area</th>
                <th className="px-4 py-3">Verified Carbon Impact</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Verified on</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={7}>
                    Loading registry…
                  </td>
                </tr>
              ) : null}
              {filtered.map((p) => (
                <tr key={p.project_code} className="border-b border-border/60 last:border-0">
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
                  <td className="px-4 py-3">
                    {ECOSYSTEM_LABEL[p.ecosystem as Ecosystem] ?? p.ecosystem}
                  </td>
                  <td className="px-4 py-3">
                    {[p.district, p.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3">{formatNumber(p.area_hectares, " ha")}</td>
                  <td className="px-4 py-3">{formatTco2e(p.verified_carbon)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status as ProjectStatus} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(p.verified_at)}</td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={7}>
                    No projects match your filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <CarbonDisclaimer className="mt-6" />
      </div>
    </PublicLayout>
  );
}
