import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ScanLine } from "lucide-react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { SectionHeading } from "@/components/StatCard";
import { CarbonDisclaimer } from "@/components/CarbonDisclaimer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/verify/")({
  head: () => ({
    meta: [
      { title: "Verify a Project · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Enter a project code or scan a QR certificate to publicly verify a blue-carbon restoration record and its Verified Carbon Impact in tCO₂e.",
      },
      { property: "og:title", content: "Verify a Project · BlueCarbon MRV Registry" },
      {
        property: "og:description",
        content: "Public verification of blue-carbon restoration records — no account required.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VerifyLookupPage,
});

function VerifyLookupPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  return (
    <PublicLayout>
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <SectionHeading
          eyebrow="Public verification"
          title="Verify a blue-carbon project"
          description="Enter the project code printed on a certificate or embedded in a QR code. No account is required."
        />

        <form
          className="panel mt-8 space-y-4 p-6"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = code.trim().toUpperCase();
            if (trimmed.length < 3) return;
            void navigate({ to: "/verify/$code", params: { code: trimmed } });
          }}
        >
          <label htmlFor="project-code" className="text-sm font-semibold">
            Project code
          </label>
          <Input
            id="project-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="e.g. BCR-2024-0001"
            autoComplete="off"
          />
          <Button type="submit" className="w-full">
            <ScanLine className="size-4" /> Verify project
          </Button>
          <p className="text-xs text-muted-foreground">
            Scanning a registry QR certificate with a phone camera opens this verification page directly.
          </p>
        </form>

        <CarbonDisclaimer className="mt-6" />
      </div>
    </PublicLayout>
  );
}
