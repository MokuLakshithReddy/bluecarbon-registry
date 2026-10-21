import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, QrCode } from "lucide-react";
import { toast } from "sonner";

export function QrVerificationPanel({ projectCode }: { projectCode: string }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}/verify/${projectCode}`;

  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2">
        <QrCode className="size-4 text-teal" />
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          QR Verification Certificate
        </p>
      </div>
      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row">
        <div className="rounded-xl border border-border bg-card p-3">
          {origin ? (
            <QRCodeSVG value={url} size={132} level="M" />
          ) : (
            <div className="size-[132px] animate-pulse rounded bg-secondary" />
          )}
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
