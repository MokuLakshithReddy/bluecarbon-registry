import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { SectionHeading } from "@/components/StatCard";
import { CarbonDisclaimer, DemoDataTag } from "@/components/CarbonDisclaimer";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About the Registry · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "About the BlueCarbon MRV Registry demonstration built for the Ministry of Earth Sciences: purpose, roles, data handling, limitations and roadmap.",
      },
      { property: "og:title", content: "About the Registry · BlueCarbon MRV Registry" },
      {
        property: "og:description",
        content:
          "Purpose, governance roles, limitations and roadmap of the blue-carbon MRV demonstration.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <PublicLayout>
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <SectionHeading
          eyebrow="About"
          title="A trusted registry for blue-carbon restoration"
          description="Built as a demonstration prototype for the Ministry of Earth Sciences problem statement on blue-carbon MRV."
        />

        <div className="panel mt-8 space-y-4 p-6 text-sm text-muted-foreground">
          <p>
            India's mangroves, seagrass meadows and coastal wetlands store disproportionate amounts
            of carbon, but restoration outcomes are hard to trust without consistent measurement,
            reporting and verification. This registry provides a single, auditable path from field
            evidence to a publicly provable verified record.
          </p>
          <p>
            Project owners — NGOs, panchayats, forest departments, community groups and research
            institutes — register sites and submit evidence. NCCR verifiers assess that evidence and
            record decisions. Members of the public verify outcomes without an account.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Project Owner",
              body: "Registers sites, uploads geotagged evidence, responds to correction requests and tracks status.",
            },
            {
              title: "NCCR Verifier",
              body: "Reviews the verification queue, inspects evidence, and approves, returns or rejects submissions.",
            },
            {
              title: "Public",
              body: "Looks up any verified project by code or QR scan to view its record and anchored hash.",
            },
          ].map((role) => (
            <div key={role.title} className="panel p-5">
              <p className="font-display text-base font-semibold">{role.title}</p>
              <p className="mt-1.5 text-sm text-muted-foreground">{role.body}</p>
            </div>
          ))}
        </div>

        <div className="panel mt-6 p-6">
          <h2 className="font-display text-lg font-semibold">Limitations of this demonstration</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              · Carbon figures use published demonstration coefficients, not accredited
              methodologies.
            </li>
            <li>
              · Blockchain anchoring runs against a simulated testnet provider in this prototype.
            </li>
            <li>
              · Project and evidence records shown are demonstration data, not official government
              records.
            </li>
            <li>· No carbon credits are issued, traded or retired by this system.</li>
          </ul>
        </div>

        <div className="panel mt-6 p-6">
          <h2 className="font-display text-lg font-semibold">Roadmap</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>· Integration with accredited blue-carbon quantification methodologies.</li>
            <li>· Remote-sensing change detection to corroborate field evidence.</li>
            <li>· Public EVM testnet and then mainnet anchoring with on-chain proof links.</li>
            <li>· Mobile field-capture application with offline evidence queueing.</li>
          </ul>
        </div>

        <CarbonDisclaimer className="mt-6" />
        <div className="mt-4">
          <DemoDataTag />
        </div>

        <p className="mt-8 text-sm">
          <Link to="/how-it-works" className="font-semibold text-primary">
            See how the MRV workflow works →
          </Link>
        </p>
      </div>
    </PublicLayout>
  );
}
