import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { MapPanel } from "@/components/MapPanel";
import { useAllProjects } from "./verifier";

export const Route = createFileRoute("/_authenticated/registry-map")({
  head: () => ({
    meta: [
      { title: "Registry Map · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Geospatial view of every registered blue-carbon restoration site along India's coastline, coloured by verification status.",
      },
      { property: "og:title", content: "Registry Map · BlueCarbon MRV Registry" },
      { property: "og:description", content: "Map of all registered restoration sites." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RegistryMapPage,
});

function RegistryMapPage() {
  const { data: projects = [] } = useAllProjects();
  const markers = projects
    .filter((p) => p.latitude != null && p.longitude != null)
    .map((p) => ({
      id: p.id,
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
    <AppShell
      title="Registry map"
      description="All restoration sites, including drafts and submissions under review."
    >
      <MapPanel height={620} markers={markers} center={[15.5, 79.5]} zoom={5} />
    </AppShell>
  );
}
