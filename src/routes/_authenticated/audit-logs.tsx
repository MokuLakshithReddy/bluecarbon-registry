import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/audit-logs")({
  head: () => ({
    meta: [
      { title: "Audit Logs · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Chronological audit trail of every registry action: submissions, reviews, verification decisions and immutable record writes.",
      },
      { property: "og:title", content: "Audit Logs · BlueCarbon MRV Registry" },
      { property: "og:description", content: "Chronological registry audit trail." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuditLogsPage,
});

function AuditLogsPage() {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  return (
    <AppShell
      title="Audit logs"
      description="Append-only record of registry actions, retained for accountability."
    >
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">Transition</th>
              <th className="px-4 py-3">Actor</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={5}>
                  Loading audit trail…
                </td>
              </tr>
            ) : null}
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 text-muted-foreground">{formatDate(log.created_at)}</td>
                <td className="px-4 py-3 font-medium">{log.action}</td>
                <td className="px-4 py-3 font-mono text-xs">{log.project_code ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {log.previous_status
                    ? `${log.previous_status} → ${log.new_status ?? "—"}`
                    : (log.new_status ?? "—")}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{log.actor_email ?? "system"}</td>
              </tr>
            ))}
            {!isLoading && logs.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={5}>
                  No audit entries recorded yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
