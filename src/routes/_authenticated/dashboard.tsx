import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Project Dashboard · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Monitor your blue-carbon restoration projects, evidence submissions and Verified Carbon Impact in tCO₂e.",
      },
      { property: "og:title", content: "Project Dashboard · BlueCarbon MRV Registry" },
      {
        property: "og:description",
        content: "Track registration, validation and verification progress for blue-carbon projects.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { profile, roles } = useAuth();
  return (
    <AppShell title="Dashboard" description="Your blue-carbon project overview.">
      <h1 className="font-display text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {profile?.email ?? "registry user"}
        {roles.length ? ` · ${roles.join(", ")}` : ""}
      </p>
    </AppShell>
  );
}
