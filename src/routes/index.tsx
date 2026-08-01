import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Leaf, MapPin, ScanLine, ShieldCheck, Sparkles, Waves } from "lucide-react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { StatCard, SectionHeading } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { CarbonDisclaimer, DemoDataTag } from "@/components/CarbonDisclaimer";
import { MapPanel } from "@/components/MapPanel";
import { getPublicProjects } from "@/lib/registry.functions";
import { ECOSYSTEM_LABEL, formatNumber, formatTco2e, type Ecosystem, type ProjectStatus } from "@/lib/domain";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BlueCarbon MRV Registry · Ministry of Earth Sciences" },
      {
        name: "description",
        content:
          "A digital MRV and registry system for India's blue-carbon restoration projects: field evidence, automated validation, NCCR verification, tamper-evident records and Verified Carbon Impact in tCO₂e.",
      },
      { property: "og:title", content: "BlueCarbon MRV Registry · Ministry of Earth Sciences" },
      {
        property: "og:description",
        content:
          "Register, monitor, verify and publicly prove blue-carbon restoration outcomes across India's coastline.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const fetchProjects = useServerFn(getPublicProjects);
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["public-projects"],
    queryFn: () => fetchProjects(),
  });

  const verified = projects.filter((p) => p.status === "VERIFIED");
  const totalCarbon = verified.reduce((sum, p) => sum + (p.verified_carbon ?? 0), 0);
  const totalArea = projects.reduce((sum, p) => sum + (p.area_hectares ?? 0), 0);
  const states = new Set(projects.map((p) => p.state).filter(Boolean)).size;

  const markers = projects
    .filter((p) => p.latitude != null && p.longitude != null)
    .map((p) => ({
      id: p.project_code,
      code: p.project_code,
      name: p.name,
      status: p.status,
      ecosystem: p.ecosystem,
      state: p.state,
      area: p.area_hectares,
      carbon: p.verified_carbon,
      latitude: p.latitude as number,
      longitude: p.longitude as number,
    }));

  return (
    <PublicLayout>
      <section className="bg-gradient-deep text-navy-foreground">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-24">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]">
            <Waves className="size-3.5" /> MoES · NCCR Demonstration
          </p>
          <h1 className="mt-5 max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl">
            Monitoring, reporting and verification for India's blue-carbon restoration
          </h1>
          <p className="mt-5 max-w-2xl text-base text-navy-foreground/80">
            Capture field evidence, screen it automatically, verify it through NCCR reviewers, anchor the
            outcome in a tamper-evident record, and let anyone prove it publicly with a project code or QR
            scan.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/register-project"
              className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-navy hover:bg-white/90"
            >
              Register a project
            </Link>
            <Link
              to="/verify"
              className="rounded-lg border border-white/30 px-5 py-2.5 text-sm font-semibold hover:bg-white/10"
            >
              Verify a project
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Verified Carbon Impact"
            value={isLoading ? "…" : formatTco2e(totalCarbon)}
            hint="Across verified projects"
            tone="teal"
            icon={<Leaf className="size-4" />}
          />
          <StatCard
            label="Verified projects"
            value={isLoading ? "…" : verified.length}
            hint={`${projects.length} registered in total`}
            tone="ocean"
            icon={<ShieldCheck className="size-4" />}
          />
          <StatCard
            label="Restoration area"
            value={isLoading ? "…" : formatNumber(totalArea, " ha")}
            hint="Mangrove, seagrass and wetland sites"
            tone="leaf"
            icon={<Sparkles className="size-4" />}
          />
          <StatCard
            label="Coastal states"
            value={isLoading ? "…" : states}
            hint="Registry coverage"
            icon={<MapPin className="size-4" />}
          />
        </div>
        <CarbonDisclaimer className="mt-6" />
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
        <SectionHeading
          eyebrow="Registry map"
          title="Where restoration is happening"
          description="Every marker is a registered project. Colour indicates its verification status."
          action={
            <Link to="/map" className="text-sm font-semibold text-primary">
              Open full map →
            </Link>
          }
        />
        <div className="mt-5">
          <MapPanel markers={markers} height={420} linkTo="public" />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <SectionHeading
          eyebrow="Public registry"
          title="Recently verified projects"
          description="Verified records are publicly provable — no account required."
          action={
            <Link to="/projects" className="text-sm font-semibold text-primary">
              View all projects →
            </Link>
          }
        />
        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(verified.length ? verified : projects).slice(0, 6).map((p) => (
            <Link
              key={p.project_code}
              to="/verify/$code"
              params={{ code: p.project_code }}
              className="panel p-5 transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-display text-base font-semibold">{p.name}</p>
                <StatusBadge status={p.status as ProjectStatus} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{p.project_code}</p>
              <p className="mt-3 text-sm text-muted-foreground">
                {ECOSYSTEM_LABEL[p.ecosystem as Ecosystem] ?? p.ecosystem}
                {p.state ? ` · ${p.state}` : ""}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Area</dt>
                  <dd className="font-semibold">{formatNumber(p.area_hectares, " ha")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Verified Carbon Impact</dt>
                  <dd className="font-semibold">{formatTco2e(p.verified_carbon)}</dd>
                </div>
              </dl>
            </Link>
          ))}
          {!isLoading && projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects registered yet.</p>
          ) : null}
        </div>
      </section>

      <section className="border-t border-border bg-secondary/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <SectionHeading
            eyebrow="How it works"
            title="Capture → Validate → Verify → Record → Prove"
            description="Five stages connect field teams, automated screening and NCCR verifiers into one auditable chain."
          />
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: MapPin,
                title: "Capture",
                body: "Project owners register sites and upload geotagged photos, drone imagery, plantation logs and survey data.",
              },
              {
                icon: Sparkles,
                title: "Validate & screen",
                body: "An evidence quality score plus AI-assisted anomaly detection flags gaps, duplicates and implausible figures before human review.",
              },
              {
                icon: ShieldCheck,
                title: "Verify",
                body: "NCCR verifiers review evidence, request corrections and approve or reject with a recorded rationale.",
              },
              {
                icon: Leaf,
                title: "Record",
                body: "Approved records are hashed and anchored to a blockchain testnet, making later tampering detectable.",
              },
              {
                icon: ScanLine,
                title: "Prove",
                body: "Each verified project gets a public page and QR certificate showing its Verified Carbon Impact in tCO₂e.",
              },
              {
                icon: Waves,
                title: "Scope",
                body: "This registry reports verified carbon impact only. It does not issue, trade or retire carbon credits.",
              },
            ].map((item) => (
              <div key={item.title} className="panel p-5">
                <span className="flex size-9 items-center justify-center rounded-lg bg-teal/15 text-teal">
                  <item.icon className="size-4" />
                </span>
                <p className="mt-3 font-display text-base font-semibold">{item.title}</p>
                <p className="mt-1.5 text-sm text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <DemoDataTag />
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
