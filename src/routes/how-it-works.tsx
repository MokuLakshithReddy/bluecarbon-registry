import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardCheck, Leaf, MapPin, ScanLine, ShieldCheck, Sparkles } from "lucide-react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { SectionHeading } from "@/components/StatCard";
import { CarbonDisclaimer } from "@/components/CarbonDisclaimer";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How MRV Works · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Understand the five-stage blue-carbon MRV workflow: evidence capture, automated validation, NCCR verification, tamper-evident recording and public proof.",
      },
      { property: "og:title", content: "How MRV Works · BlueCarbon MRV Registry" },
      {
        property: "og:description",
        content:
          "From geotagged field evidence to a publicly provable Verified Carbon Impact record.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HowItWorksPage,
});

const STAGES = [
  {
    icon: MapPin,
    title: "1 · Capture",
    body: "Project owners register a restoration site with its ecosystem, boundary coordinates, area, species and restoration method, then upload geotagged photographs, drone imagery, plantation logs, survey sheets and community records.",
  },
  {
    icon: Sparkles,
    title: "2 · Validate",
    body: "Every submission is scored out of 100 for evidence quality: required fields present, GPS coordinates valid and inside the declared site, capture dates plausible, and no duplicate files. AI-assisted screening flags anomalies such as missing geotags, thin evidence volume or implausible plantation density.",
  },
  {
    icon: ClipboardCheck,
    title: "3 · Verify",
    body: "NCCR verifiers open the review workspace, inspect each evidence item, mark items valid or suspicious, and then approve, request corrections or reject with a recorded rationale. Every decision is written to an audit trail.",
  },
  {
    icon: Leaf,
    title: "4 · Record",
    body: "On approval, the registry computes the Verified Carbon Impact in tCO₂e using published demonstration coefficients, builds a canonical record, hashes it and anchors the hash to a blockchain testnet so later tampering becomes detectable.",
  },
  {
    icon: ScanLine,
    title: "5 · Prove",
    body: "Each verified project receives a public verification page and QR certificate. Anyone can scan or enter the project code to see the verified record, its timeline and the anchored hash — no account needed.",
  },
];

function HowItWorksPage() {
  return (
    <PublicLayout>
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <SectionHeading
          eyebrow="Methodology"
          title="How the MRV workflow works"
          description="The registry connects field teams, automated screening and government verifiers into a single auditable chain of custody."
        />

        <ol className="mt-8 space-y-4">
          {STAGES.map((stage) => (
            <li key={stage.title} className="panel p-6">
              <div className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ocean/10 text-ocean">
                  <stage.icon className="size-5" />
                </span>
                <div>
                  <h2 className="font-display text-lg font-semibold">{stage.title}</h2>
                  <p className="mt-1.5 text-sm text-muted-foreground">{stage.body}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="panel mt-8 p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <ShieldCheck className="size-4 text-teal" /> Scope of claims
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The registry reports <strong>Verified Carbon Impact (tCO₂e)</strong> — an independently
            reviewed estimate of carbon benefit from restoration activity. It does not issue, trade,
            retire or certify carbon credits, and it is not a substitute for accredited carbon
            standards.
          </p>
        </div>

        <CarbonDisclaimer className="mt-6" />

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/register-project"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Register a project
          </Link>
          <Link
            to="/verify"
            className="rounded-lg border border-border px-5 py-2.5 text-sm font-semibold hover:bg-secondary"
          >
            Verify a project code
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
