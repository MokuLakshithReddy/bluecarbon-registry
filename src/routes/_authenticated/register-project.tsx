import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { CarbonDisclaimer } from "@/components/CarbonDisclaimer";
import { MapPanel } from "@/components/MapPanel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  ECOSYSTEM_LABEL,
  ECOSYSTEM_OPTIONS,
  INDIAN_COASTAL_STATES,
  estimateCarbonImpact,
  formatTco2e,
  type Ecosystem,
} from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/register-project")({
  head: () => ({
    meta: [
      { title: "Register a Project · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Register a mangrove, seagrass or coastal wetland restoration project with site coordinates, restoration method and area for MRV verification.",
      },
      { property: "og:title", content: "Register a Project · BlueCarbon MRV Registry" },
      {
        property: "og:description",
        content: "Submit a blue-carbon restoration site for NCCR verification.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RegisterProjectPage,
});

function RegisterProjectPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    organization: "",
    ecosystem: "MANGROVE" as Ecosystem,
    state: INDIAN_COASTAL_STATES[0] ?? "",
    district: "",
    coastal_area: "",
    latitude: "",
    longitude: "",
    area_hectares: "",
    restoration_start: "",
    restoration_end: "",
    restoration_method: "",
    species: "",
    plant_count: "",
    survival_rate: "",
  });

  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const area = Number(form.area_hectares) || 0;
  const estimate = estimateCarbonImpact({
    ecosystem: form.ecosystem,
    area_hectares: area,
    restoration_start: form.restoration_start || null,
    restoration_end: form.restoration_end || null,
    survival_rate: Number(form.survival_rate) || null,
  });

  const lat = Number(form.latitude);
  const lng = Number(form.longitude);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng) && form.latitude !== "" && form.longitude !== "";

  return (
    <AppShell
      title="Register a restoration project"
      description="Provide site details and coordinates. You can upload field evidence after the project is created."
    >
      <form
        className="grid gap-6 lg:grid-cols-[1.4fr_1fr]"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            const { data: codeData, error: codeError } = await supabase.rpc("next_project_code");
            if (codeError) throw new Error(codeError.message);
            const { data, error } = await supabase
              .from("projects")
              .insert({
                project_code: String(codeData),
                owner_id: user?.id ?? null,
                owner_email: user?.email ?? "",
                owner_name: profile?.full_name ?? null,
                contact_email: user?.email ?? null,
                contact_phone: profile?.phone ?? null,
                name: form.name.trim(),
                description: form.description.trim() || null,
                organization: form.organization.trim() || profile?.organization || null,
                ecosystem: form.ecosystem,
                state: form.state || null,
                district: form.district.trim() || null,
                coastal_area: form.coastal_area.trim() || null,
                latitude: hasPoint ? lat : null,
                longitude: hasPoint ? lng : null,
                area_hectares: area || null,
                restoration_start: form.restoration_start || null,
                restoration_end: form.restoration_end || null,
                restoration_method: form.restoration_method.trim() || null,
                species: form.species.trim() || null,
                plant_count: Number(form.plant_count) || null,
                survival_rate: Number(form.survival_rate) || null,
                estimated_carbon: estimate || null,
                status: "SUBMITTED",
                submitted_at: new Date().toISOString(),
              })
              .select("project_code")
              .single();
            if (error) throw new Error(error.message);
            toast.success(`Project ${data.project_code} submitted for verification.`);
            void navigate({ to: "/my-projects" });
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not register project");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-6">
          <div className="panel space-y-4 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Project identity
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Project name</Label>
              <Input id="p-name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-org">Implementing organization</Label>
              <Input
                id="p-org"
                value={form.organization}
                onChange={(e) => set("organization", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-desc">Description</Label>
              <Textarea
                id="p-desc"
                rows={4}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
          </div>

          <div className="panel grid gap-4 p-5 sm:grid-cols-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground sm:col-span-2">
              Site and ecosystem
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="p-eco">Ecosystem</Label>
              <select
                id="p-eco"
                value={form.ecosystem}
                onChange={(e) => set("ecosystem", e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm"
              >
                {ECOSYSTEM_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {ECOSYSTEM_LABEL[option]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-state">Coastal state / UT</Label>
              <select
                id="p-state"
                value={form.state}
                onChange={(e) => set("state", e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm"
              >
                {INDIAN_COASTAL_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-district">District</Label>
              <Input id="p-district" value={form.district} onChange={(e) => set("district", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-coast">Coastal area / creek</Label>
              <Input
                id="p-coast"
                value={form.coastal_area}
                onChange={(e) => set("coastal_area", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-lat">Latitude</Label>
              <Input id="p-lat" value={form.latitude} onChange={(e) => set("latitude", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-lng">Longitude</Label>
              <Input id="p-lng" value={form.longitude} onChange={(e) => set("longitude", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <p className="mb-2 text-xs text-muted-foreground">
                Click the map to set the site coordinates.
              </p>
              <MapPanel
                height={300}
                center={hasPoint ? [lat, lng] : [15.5, 79.5]}
                zoom={hasPoint ? 9 : 5}
                selectable
                linkTo="none"
                onSelect={(nextLat, nextLng) => {
                  set("latitude", String(nextLat));
                  set("longitude", String(nextLng));
                }}
                markers={
                  hasPoint
                    ? [
                        {
                          id: "new",
                          code: "NEW",
                          name: form.name || "Selected site",
                          status: "DRAFT",
                          ecosystem: form.ecosystem,
                          state: form.state,
                          area: area || null,
                          carbon: null,
                          latitude: lat,
                          longitude: lng,
                        },
                      ]
                    : []
                }
              />
            </div>
          </div>

          <div className="panel grid gap-4 p-5 sm:grid-cols-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground sm:col-span-2">
              Restoration activity
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="p-area">Area (hectares)</Label>
              <Input
                id="p-area"
                required
                value={form.area_hectares}
                onChange={(e) => set("area_hectares", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-method">Restoration method</Label>
              <Input
                id="p-method"
                value={form.restoration_method}
                onChange={(e) => set("restoration_method", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-start">Restoration start</Label>
              <Input
                id="p-start"
                type="date"
                value={form.restoration_start}
                onChange={(e) => set("restoration_start", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-end">Restoration end</Label>
              <Input
                id="p-end"
                type="date"
                value={form.restoration_end}
                onChange={(e) => set("restoration_end", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-species">Species planted</Label>
              <Input id="p-species" value={form.species} onChange={(e) => set("species", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-count">Plant count</Label>
              <Input
                id="p-count"
                value={form.plant_count}
                onChange={(e) => set("plant_count", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-survival">Survival rate (%)</Label>
              <Input
                id="p-survival"
                value={form.survival_rate}
                onChange={(e) => set("survival_rate", e.target.value)}
              />
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="panel p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Indicative carbon estimate
            </p>
            <p className="mt-3 font-display text-2xl font-semibold">{formatTco2e(estimate)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Demonstration coefficient for {ECOSYSTEM_LABEL[form.ecosystem]}. The final Verified Carbon Impact
              is confirmed by an NCCR verifier.
            </p>
          </div>
          <CarbonDisclaimer />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Submit for verification
          </Button>
        </aside>
      </form>
    </AppShell>
  );
}
