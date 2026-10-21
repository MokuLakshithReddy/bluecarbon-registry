import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Building2, Leaf, MapPin, Ruler } from "lucide-react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { CarbonDisclaimer, DemoDataTag } from "@/components/CarbonDisclaimer";
import { BlockchainPanel } from "@/components/BlockchainPanel";
import { TimelinePanel } from "@/components/TimelinePanel";
import { QrVerificationPanel } from "@/components/QrVerificationPanel";
import { MapPanel } from "@/components/MapPanel";
import { getPublicProject } from "@/lib/registry.functions";
import {
  ECOSYSTEM_LABEL,
  formatDate,
  formatNumber,
  formatTco2e,
  type Ecosystem,
  type ProjectStatus,
} from "@/lib/domain";

export const Route = createFileRoute("/verify/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Verify ${params.code} · BlueCarbon MRV Registry` },
      {
        name: "description",
        content: `Public verification record for blue-carbon project ${params.code}, including restoration details, evidence timeline, Verified Carbon Impact in tCO₂e and its tamper-evident record hash.`,
      },
      { property: "og:title", content: `Verify ${params.code} · BlueCarbon MRV Registry` },
      {
        property: "og:description",
        content: `Independently reviewed restoration record for project ${params.code}.`,
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PublicVerifyPage,
});

function PublicVerifyPage() {
  const { code } = Route.useParams();
  const fetchProject = useServerFn(getPublicProject);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["public-project", code],
    queryFn: () => fetchProject({ data: { code } }),
    retry: false,
  });

  if (isLoading) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <p className="text-sm text-muted-foreground">Loading verification record…</p>
        </div>
      </PublicLayout>
    );
  }

  if (isError || !data?.project) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
          <h1 className="font-display text-2xl font-semibold">No public record for “{code}”</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Only projects verified by NCCR reviewers are published publicly. Check the code and try
            again.
          </p>
          <Link to="/verify" className="mt-6 inline-block text-sm font-semibold text-primary">
            ← Verify another project
          </Link>
        </div>
      </PublicLayout>
    );
  }

  const { project, blockchain, timeline } = data;
  const markers =
    project.latitude != null && project.longitude != null
      ? [
          {
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
          },
        ]
      : [];

  return (
    <PublicLayout>
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <Link
          to="/projects"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground"
        >
          <ArrowLeft className="size-4" /> All projects
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal">
              Public verification record
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold">{project.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {project.project_code}
              {project.organization ? ` · ${project.organization}` : ""}
            </p>
          </div>
          <StatusBadge status={project.status as ProjectStatus} />
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Verified Carbon Impact"
            value={formatTco2e(project.verified_carbon)}
            hint={
              project.verified_at
                ? `Verified ${formatDate(project.verified_at)}`
                : "Pending verification"
            }
            tone="teal"
            icon={<Leaf className="size-4" />}
          />
          <StatCard
            label="Restoration area"
            value={formatNumber(project.area_hectares, " ha")}
            hint={ECOSYSTEM_LABEL[project.ecosystem as Ecosystem] ?? project.ecosystem}
            tone="leaf"
            icon={<Ruler className="size-4" />}
          />
          <StatCard
            label="Location"
            value={[project.district, project.state].filter(Boolean).join(", ") || "—"}
            hint={project.coastal_area ?? "Coastal restoration site"}
            tone="ocean"
            icon={<MapPin className="size-4" />}
          />
          <StatCard
            label="Verified by"
            value={project.verifier_name ?? "NCCR"}
            hint="National Centre for Coastal Research"
            icon={<Building2 className="size-4" />}
          />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="panel p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Project details
              </p>
              {project.description ? (
                <p className="mt-3 text-sm text-muted-foreground">{project.description}</p>
              ) : null}
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                {[
                  [
                    "Ecosystem",
                    ECOSYSTEM_LABEL[project.ecosystem as Ecosystem] ?? project.ecosystem,
                  ],
                  ["Restoration method", project.restoration_method ?? "—"],
                  ["Species", project.species ?? "—"],
                  ["Restoration start", formatDate(project.restoration_start)],
                  ["Restoration end", formatDate(project.restoration_end)],
                  ["Registered", formatDate(project.created_at)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="text-sm font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {markers.length ? (
              <MapPanel
                markers={markers}
                center={[markers[0]!.latitude, markers[0]!.longitude]}
                zoom={9}
                height={320}
                linkTo="none"
              />
            ) : null}

            <TimelinePanel
              events={timeline.map((event) => ({
                label: event.label,
                detail: event.detail,
                created_at: event.created_at,
              }))}
            />
          </div>

          <div className="space-y-6">
            <BlockchainPanel record={blockchain} projectCode={project.project_code} />
            {project.status === "VERIFIED" ? (
              <QrVerificationPanel projectCode={project.project_code} />
            ) : null}
            <CarbonDisclaimer />
            <DemoDataTag />
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
