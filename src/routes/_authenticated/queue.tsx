import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { useAllProjects } from "./verifier";
import { formatDate, formatNumber, type ProjectStatus } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/queue")({
  head: () => ({
    meta: [
      { title: "Verification Queue · BlueCarbon MRV Registry" },
      { name: "description", content: "Blue-carbon restoration submissions awaiting NCCR review, ordered by submission date." },
      { property: "og:title", content: "Verification Queue · BlueCarbon MRV Registry" },
      { property: "og:description", content: "Submissions awaiting NCCR review." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: QueuePage,
});

function QueuePage() {
  const { data: projects = [], isLoading } = useAllProjects();
  const queue = projects.filter((p) =>
    ["SUBMITTED", "UNDER_REVIEW", "CORRECTION_REQUIRED"].includes(p.status),
  );

  return (
    <AppShell title="Verification queue" description="Projects that still need a verifier decision.">
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">Ecosystem</th>
              <th className="px-4 py-3">Area</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td className="px-4 py-6 text-muted-foreground" colSpan={6}>Loading queue…</td></tr>
            ) : null}
            {queue.map((p) => (
              <tr key={p.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-semibold">
                  {p.name}
                  <span className="block text-xs font-normal text-muted-foreground">{p.project_code}</span>
                </td>
                <td className="px-4 py-3">{p.ecosystem}</td>
                <td className="px-4 py-3">{formatNumber(p.area_hectares, " ha")}</td>
                <td className="px-4 py-3"><StatusBadge status={p.status as ProjectStatus} /></td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(p.submitted_at)}</td>
                <td className="px-4 py-3 text-right">
                  <Link to="/review/$id" params={{ id: p.id }} className="text-sm font-semibold text-primary hover:underline">Open review</Link>
                </td>
              </tr>
            ))}
            {!isLoading && queue.length === 0 ? (
              <tr><td className="px-4 py-6 text-muted-foreground" colSpan={6}>The queue is clear.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
