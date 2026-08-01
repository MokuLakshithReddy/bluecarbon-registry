import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { MapPanel } from "@/components/MapPanel";
import { EvidenceGallery } from "@/components/EvidenceGallery";
import { CarbonDisclaimer } from "@/components/CarbonDisclaimer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  approveProjectFn,
  beginVerification,
  rejectProjectFn,
  requestCorrectionFn,
} from "@/lib/registry.functions";
import {
  ECOSYSTEM_LABEL,
  formatDate,
  formatNumber,
  formatTco2e,
  type Ecosystem,
  type EvidenceRow,
  type ProjectStatus,
} from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/review/$id")({
  head: () => ({
    meta: [
      { title: "Evidence Review · BlueCarbon MRV Registry" },
      { name: "description", content: "NCCR review workspace: inspect geotagged evidence, validation checks and risk flags before confirming Verified Carbon Impact." },
      { property: "og:title", content: "Evidence Review · BlueCarbon MRV Registry" },
      { property: "og:description", content: "Inspect evidence and record a verification decision." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { id } = Route.useParams();
  const { isVerifier } = useAuth();
  const queryClient = useQueryClient();
  const [comments, setComments] = useState("");
  const [confirmed, setConfirmed] = useState("");
  const [busy, setBusy] = useState(false);

  const start = useServerFn(beginVerification);
  const approve = useServerFn(approveProjectFn);
  const correct = useServerFn(requestCorrectionFn);
  const reject = useServerFn(rejectProjectFn);

  const { data, isLoading } = useQuery({
    queryKey: ["review", id],
    queryFn: async () => {
      const [projectRes, evidenceRes] = await Promise.all([
        supabase.from("projects").select("*").eq("id", id).maybeSingle(),
        supabase.from("evidence").select("*").eq("project_id", id).order("created_at"),
      ]);
      if (projectRes.error) throw new Error(projectRes.error.message);
      return {
        project: projectRes.data,
        evidence: (evidenceRes.data ?? []) as unknown as EvidenceRow[],
      };
    },
  });

  const project = data?.project;

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(message);
      await queryClient.invalidateQueries({ queryKey: ["review", id] });
      await queryClient.invalidateQueries({ queryKey: ["registry-projects"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return <AppShell title="Evidence review"><p className="text-sm text-muted-foreground">Loading project…</p></AppShell>;
  }
  if (!project) {
    return <AppShell title="Evidence review"><p className="text-sm text-muted-foreground">Project not found or not accessible.</p></AppShell>;
  }

  const payload = { projectId: project.id, comments: comments.trim() || null };

  return (
    <AppShell
      title={project.name}
      description={`${project.project_code} · ${ECOSYSTEM_LABEL[project.ecosystem as Ecosystem] ?? project.ecosystem}`}
      actions={<StatusBadge status={project.status as ProjectStatus} />}
    >
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <dl className="panel grid gap-4 p-5 sm:grid-cols-3">
            <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Area</dt><dd className="mt-1 font-semibold">{formatNumber(project.area_hectares, " ha")}</dd></div>
            <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Estimated impact</dt><dd className="mt-1 font-semibold">{formatTco2e(project.estimated_carbon)}</dd></div>
            <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Verified impact</dt><dd className="mt-1 font-semibold">{formatTco2e(project.verified_carbon)}</dd></div>
            <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Location</dt><dd className="mt-1">{[project.district, project.state].filter(Boolean).join(", ") || "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Submitted</dt><dd className="mt-1">{formatDate(project.submitted_at)}</dd></div>
            <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Owner</dt><dd className="mt-1 break-all">{project.owner_email}</dd></div>
          </dl>

          {project.latitude != null && project.longitude != null ? (
            <MapPanel
              height={280}
              center={[project.latitude, project.longitude]}
              zoom={10}
              linkTo="none"
              markers={[{
                id: project.id,
                code: project.project_code,
                name: project.name,
                status: project.status,
                ecosystem: project.ecosystem,
                state: project.state,
                area: project.area_hectares,
                carbon: project.verified_carbon,
                latitude: project.latitude,
                longitude: project.longitude,
              }]}
            />
          ) : null}

          <EvidenceGallery items={data?.evidence ?? []} />
        </div>

        <aside className="space-y-4">
          <div className="panel space-y-3 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Verification decision</p>
            {!isVerifier ? (
              <p className="text-sm text-muted-foreground">Only NCCR verifiers can record a decision.</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmed">Confirmed Verified Carbon Impact (tCO₂e)</Label>
                  <Input id="confirmed" value={confirmed} onChange={(e) => setConfirmed(e.target.value)} placeholder={String(project.estimated_carbon ?? "")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="comments">Verifier comments</Label>
                  <Textarea id="comments" rows={4} value={comments} onChange={(e) => setComments(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Button variant="outline" disabled={busy} onClick={() => void run(() => start({ data: payload }), "Review started.")}>Start review</Button>
                  <Button disabled={busy} onClick={() => void run(() => approve({ data: { ...payload, confirmedCarbon: Number(confirmed) || null } }), "Project verified and recorded.")}>Approve &amp; record</Button>
                  <Button variant="outline" disabled={busy} onClick={() => void run(() => correct({ data: payload }), "Correction requested.")}>Request correction</Button>
                  <Button variant="destructive" disabled={busy} onClick={() => void run(() => reject({ data: payload }), "Project rejected.")}>Reject</Button>
                </div>
              </>
            )}
          </div>
          <CarbonDisclaimer />
        </aside>
      </div>
    </AppShell>
  );
}
