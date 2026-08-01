import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { SectionHeading } from "@/components/StatCard";
import { CarbonDisclaimer } from "@/components/CarbonDisclaimer";
import { MapPanel } from "@/components/MapPanel";
import { getPublicProjects } from "@/lib/registry.functions";

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Coastal Project Map · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Interactive map of India's registered blue-carbon restoration sites, coloured by verification status with area and Verified Carbon Impact details.",
      },
      { property: "og:title", content: "Coastal Project Map · BlueCarbon MRV Registry" },
      {
        property: "og:description",
        content: "Explore mangrove, seagrass and coastal wetland restoration sites across India.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MapPage,
});

const LEGEND = [
  { label: "Verified", color: "#2f9e6e" },
  { label: "Under review", color: "#d99b32" },
  { label: "Submitted", color: "#3b74c4" },
  { label: "Correction required", color: "#c47f1f" },
  { label: "Draft", color: "#8a94a6" },
  { label: "Rejected", color: "#c2453c" },
];

function MapPage() {
  const fetchProjects = useServerFn(getPublicProjects);
  const { data: projects = [] } = useQuery({
    queryKey: ["public-projects"],
    queryFn: () => fetchProjects(),
  });

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
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <SectionHeading
          eyebrow="Registry map"
          title="Coastal restoration sites"
          description="Click any marker for site details and a link to its public verification record."
        />
        <div className="mt-5">
          <MapPanel markers={markers} height={560} linkTo="public" />
        </div>
        <div className="mt-4 flex flex-wrap gap-4">
          {LEGEND.map((item) => (
            <span key={item.label} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-3 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
        <CarbonDisclaimer className="mt-6" />
      </div>
    </PublicLayout>
  );
}
