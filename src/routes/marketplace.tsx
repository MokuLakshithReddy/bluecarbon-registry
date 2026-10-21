import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BadgeCheck, Building2, FileSearch, Loader2, Send } from "lucide-react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { SectionHeading } from "@/components/StatCard";
import { CarbonDisclaimer } from "@/components/CarbonDisclaimer";
import { getPublicProjects } from "@/lib/registry.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  ECOSYSTEM_LABEL,
  ECOSYSTEM_OPTIONS,
  formatDate,
  formatNumber,
  formatTco2e,
  type Ecosystem,
} from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/marketplace")({
  head: () => ({
    meta: [
      { title: "Corporate Marketplace · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Companies can review NCCR-verified blue-carbon restoration projects, inspect their field evidence and blockchain records, and register an expression of interest in their Verified Carbon Impact (tCO₂e).",
      },
      { property: "og:title", content: "Corporate Marketplace · BlueCarbon MRV Registry" },
      {
        property: "og:description",
        content:
          "Verified blue-carbon projects with provable evidence, open to corporate expressions of interest.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketplacePage,
});

interface InterestTarget {
  project_code: string;
  name: string;
  verified_carbon: number | null;
}

function MarketplacePage() {
  const fetchProjects = useServerFn(getPublicProjects);
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [ecosystem, setEcosystem] = useState("ALL");
  const [target, setTarget] = useState<InterestTarget | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["public-projects"],
    queryFn: () => fetchProjects(),
  });

  const verified = useMemo(() => projects.filter((p) => p.status === "VERIFIED"), [projects]);

  const filtered = verified.filter((p) => {
    const haystack = `${p.name} ${p.project_code} ${p.state ?? ""} ${p.district ?? ""} ${
      p.organization ?? ""
    }`.toLowerCase();
    return (
      haystack.includes(query.trim().toLowerCase()) &&
      (ecosystem === "ALL" || p.ecosystem === ecosystem)
    );
  });

  const totalImpact = verified.reduce((sum, p) => sum + Number(p.verified_carbon ?? 0), 0);

  return (
    <PublicLayout>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <SectionHeading
          eyebrow="Marketplace"
          title="Verified projects open to corporate interest"
          description="Every listing below has passed NCCR verification and carries a tamper-evident registry record. Companies can inspect the evidence and register an expression of interest — the registry does not sell or issue carbon credits."
        />

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="panel p-4">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Verified projects
            </p>
            <p className="mt-1 font-display text-2xl font-semibold">{verified.length}</p>
          </div>
          <div className="panel p-4">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Verified Carbon Impact
            </p>
            <p className="mt-1 font-display text-2xl font-semibold">{formatTco2e(totalImpact)}</p>
          </div>
          <div className="panel p-4">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Transaction model
            </p>
            <p className="mt-1 text-sm font-semibold">Expression of interest only</p>
            <p className="text-xs text-muted-foreground">
              No credits are issued, sold or transferred through this registry.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search verified projects…"
            className="max-w-xs"
            aria-label="Search verified projects"
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
          <p className="text-sm text-muted-foreground">{filtered.length} listings</p>
        </div>

        {isLoading ? (
          <p className="mt-8 text-sm text-muted-foreground">Loading verified projects…</p>
        ) : filtered.length === 0 ? (
          <div className="panel mt-8 p-8 text-center text-sm text-muted-foreground">
            No verified projects match your filters yet.
          </div>
        ) : (
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <article key={p.project_code} className="panel flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-base font-semibold leading-snug">{p.name}</h3>
                    <p className="text-xs text-muted-foreground">{p.project_code}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-wider text-success">
                    <BadgeCheck className="size-3.5" /> Verified
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                      Impact
                    </dt>
                    <dd className="font-semibold">{formatTco2e(p.verified_carbon)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                      Area
                    </dt>
                    <dd>{formatNumber(p.area_hectares, " ha")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                      Ecosystem
                    </dt>
                    <dd>{ECOSYSTEM_LABEL[p.ecosystem as Ecosystem] ?? p.ecosystem}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                      Verified on
                    </dt>
                    <dd>{formatDate(p.verified_at)}</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">
                  {[p.district, p.state].filter(Boolean).join(", ") || "Location withheld"}
                  {p.organization ? ` · ${p.organization}` : ""}
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <Link
                    to="/verify/$code"
                    params={{ code: p.project_code }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-secondary"
                  >
                    <FileSearch className="size-4" /> Evidence & record
                  </Link>
                  <Button
                    size="sm"
                    onClick={() =>
                      setTarget({
                        project_code: p.project_code,
                        name: p.name,
                        verified_carbon: p.verified_carbon,
                      })
                    }
                  >
                    <Building2 className="size-4" /> Express interest
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="mt-10">
          <CarbonDisclaimer />
        </div>
      </div>

      <InterestDialog target={target} signedIn={!!session} onClose={() => setTarget(null)} />
    </PublicLayout>
  );
}

function InterestDialog({
  target,
  signedIn,
  onClose,
}: {
  target: InterestTarget | null;
  signedIn: boolean;
  onClose: () => void;
}) {
  const { user, profile } = useAuth();
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [volume, setVolume] = useState("");
  const [use, setUse] = useState("");
  const [message, setMessage] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      if (!user || !target) throw new Error("Please sign in to submit an expression of interest.");
      const { data: project, error: lookupError } = await supabase
        .from("projects")
        .select("id")
        .eq("project_code", target.project_code)
        .maybeSingle();
      if (lookupError) throw new Error(lookupError.message);
      if (!project) throw new Error("This project is no longer available.");

      const { error } = await supabase.from("marketplace_interests").insert({
        project_id: project.id,
        requester_id: user.id,
        company_name: company.trim(),
        contact_name: contact.trim() || profile?.full_name || "—",
        contact_email: email.trim() || profile?.email || user.email || "",
        contact_phone: phone.trim() ? phone.trim() : null,
        requested_tco2e: volume.trim() ? Number(volume) : null,
        intended_use: use.trim() ? use.trim() : null,
        message: message.trim() ? message.trim() : null,
        status: "NEW",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Expression of interest recorded. The registry team will be in touch.");
      setCompany("");
      setPhone("");
      setVolume("");
      setUse("");
      setMessage("");
      onClose();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not submit your interest"),
  });

  return (
    <Dialog open={!!target} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Express interest · {target?.name}</DialogTitle>
          <DialogDescription>
            This registers a non-binding enquiry with the registry team. No carbon credits are
            issued, sold or transferred here.
          </DialogDescription>
        </DialogHeader>

        {!signedIn ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Sign in with a company account to register an expression of interest.
            </p>
            <Link
              to="/auth"
              className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="interest-company">Company / organisation</Label>
              <Input
                id="interest-company"
                required
                value={company}
                onChange={(event) => setCompany(event.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="interest-contact">Contact person</Label>
                <Input
                  id="interest-contact"
                  value={contact}
                  placeholder={profile?.full_name ?? ""}
                  onChange={(event) => setContact(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="interest-email">Contact email</Label>
                <Input
                  id="interest-email"
                  type="email"
                  value={email}
                  placeholder={profile?.email ?? ""}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="interest-phone">Phone (optional)</Label>
                <Input
                  id="interest-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="interest-volume">Interest in tCO₂e (optional)</Label>
                <Input
                  id="interest-volume"
                  type="number"
                  min={1}
                  step="0.01"
                  value={volume}
                  onChange={(event) => setVolume(event.target.value)}
                />
                {target?.verified_carbon != null ? (
                  <p className="text-xs text-muted-foreground">
                    Project impact: {formatTco2e(target.verified_carbon)}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="interest-use">Intended use (optional)</Label>
              <Input
                id="interest-use"
                value={use}
                placeholder="CSR reporting, sustainability disclosure, co-funding restoration…"
                onChange={(event) => setUse(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="interest-message">Message (optional)</Label>
              <Textarea
                id="interest-message"
                rows={4}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={submit.isPending} className="w-full">
              {submit.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Submit expression of interest
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
