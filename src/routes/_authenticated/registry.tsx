import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { useAllProjects } from "./verifier";
import { formatNumber, formatTco2e, type ProjectStatus } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/registry")({
  head: () => ({
    meta: [
      { title: "Registry Projects · BlueCarbon MRV Registry" },
      { name: "description", content: "Search every registered mangrove, seagrass and coastal wetland restoration project with status and Verified Carbon Impact." },
      { property: "og:title", content: "Registry Projects · BlueCarbon MRV Registry" },
      { property: "og:description", content: "All registered blue-carbon restoration projects." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RegistryPage,
});

function RegistryPage() {
  const { data: projects = [] } = useAllProjects();
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const rows = term
    ? projects.filter((p) =>
        [p.name, p.project_code, p.state, p.district].some((v) => (v ?? "").toLowerCase().includes(term)),
      )
    : projects;

  return (
    <AppShell title="Registry projects" description="Complete registry view across all coastal states and union territories.">
      <Input
        className="mb-4 max-w-sm"
        placeholder="Search by name, code or state"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Ecosystem</th>
              <th className="px-4 py-3">Area</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Verified Carbon Impact</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-semibold">
                  {p.name}
                  <span className="block text-xs font-normal text-muted-foreground">{p.project_code}</span>
                </td>
                <td className="px-4 py-3">{p.state ?? "—"}</td>
                <td className="px-4 py-3">{p.ecosystem}</td>
                <td className="px-4 py-3">{formatNumber(p.area_hectares, " ha")}</td>
                <td className="px-4 py-3"><StatusBadge status={p.status as ProjectStatus} /></td>
                <td className="px-4 py-3">{formatTco2e(p.verified_carbon)}</td>
                <td className="px-4 py-3 text-right">
                  <Link to="/review/$id" params={{ id: p.id }} className="text-sm font-semibold text-primary hover:underline">Review</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
