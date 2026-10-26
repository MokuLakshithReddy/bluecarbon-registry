import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Download, QrCode } from "lucide-react";
import { toast } from "sonner";
import { isSyntheticFixture, SyntheticFixtureBadge } from "@/components/CarbonDisclaimer";

export function QrVerificationPanel({ projectCode }: { projectCode: string }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}/verify/${projectCode}`;
  const isSynthetic = isSyntheticFixture(projectCode);

  const handleExportCertificateJson = () => {
    const certificatePayload = {
      project_code: projectCode,
      verification_url: url,
      data_classification: isSynthetic
        ? "SYNTHETIC_DEMONSTRATION_FIXTURE"
        : "AUTHENTICATED_FIELD_RECORD",
      disclaimer: isSynthetic
        ? "SYNTHETIC DEMONSTRATION FIXTURE — Calibrated test data only. Not for commercial credit issuance or retirement."
        : "Standard MRV verification certificate.",
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(certificatePayload, null, 2)], {
      type: "application/json",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `${projectCode}-verification-certificate.json`;
    a.click();
    URL.revokeObjectURL(downloadUrl);
    toast.success("Verification certificate exported.");
  };

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <QrCode className="size-4 text-teal" />
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            QR Verification Certificate
          </p>
        </div>
        {isSynthetic ? <SyntheticFixtureBadge /> : null}
      </div>

      {isSynthetic ? (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[0.7rem] font-medium text-amber-800 dark:text-amber-300">
          ⚠️ <strong>SYNTHETIC DEMONSTRATION FIXTURE</strong>: Modeled reference data only. Not
          authorized for commercial carbon credit retirement.
        </div>
      ) : null}

      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row">
        <div className="relative rounded-xl border border-border bg-card p-3">
          {origin ? (
            <QRCodeSVG value={url} size={132} level="M" />
          ) : (
            <div className="size-[132px] animate-pulse rounded bg-secondary" />
          )}
          {isSynthetic ? (
            <span className="absolute bottom-1 right-1 rounded bg-amber-500/90 px-1 text-[0.55rem] font-bold text-white uppercase">
              Synthetic
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm text-muted-foreground">
            Scan or share this code to open the public verification page for{" "}
            <span className="font-semibold text-foreground">{projectCode}</span>.
          </p>
          <p className="mono-hash rounded-lg border border-border bg-secondary/60 p-2">
            {url || "…"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                toast.success("Verification link copied.");
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
            >
              <Copy className="size-3.5" /> Copy link
            </button>
            <button
              type="button"
              onClick={handleExportCertificateJson}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
            >
              <Download className="size-3.5" /> Export certificate
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Open public page
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
