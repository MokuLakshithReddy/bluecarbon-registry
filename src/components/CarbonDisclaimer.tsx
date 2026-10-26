import { AlertTriangle, Info } from "lucide-react";
import { CARBON_DISCLAIMER } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function isSyntheticFixture(textOrObj: unknown): boolean {
  if (!textOrObj) return false;
  const str = typeof textOrObj === "string" ? textOrObj : JSON.stringify(textOrObj);
  return (
    str.includes("SYNTHETIC_DEMONSTRATION_FIXTURE") ||
    str.includes("CAL-YSI-2024-8891-SYNTHETIC") ||
    str.includes("PRJ-LOTH-2024") ||
    str.includes("LOTHIAN-DEMO") ||
    str.includes("lothian-sediment-cores-2024") ||
    str.includes("lothian-allometric-census-2024") ||
    str.includes("lothian-sentinel2-surface-reflectance-2024") ||
    str.includes("lothian-ysi-telemetry-2024")
  );
}

export function CarbonDisclaimer({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-xs leading-relaxed text-warning-foreground",
        className,
      )}
    >
      <Info className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-semibold">Scope note — no carbon credits are issued. </span>
        {CARBON_DISCLAIMER}
      </p>
    </div>
  );
}

export function DemoDataTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground",
        className,
      )}
    >
      Demo Data
    </span>
  );
}

export function SyntheticFixtureBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      <AlertTriangle className="size-3" /> Synthetic Fixture
    </span>
  );
}

export function SyntheticFixtureBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-900 dark:text-amber-200",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div>
        <p className="font-semibold uppercase tracking-wider text-amber-950 dark:text-amber-100">
          Synthetic Demonstration Fixture
        </p>
        <p className="mt-0.5">
          This record incorporates demonstration fixtures and calibrated modeling data (synthetic
          soil cores, allometric census models, satellite summary statistics, or simulated
          telemetry). It is strictly classified as{" "}
          <code className="rounded bg-amber-500/20 px-1 py-0.5 font-mono text-[0.7rem] font-bold">
            SYNTHETIC_DEMONSTRATION_FIXTURE
          </code>{" "}
          and must NOT be represented, traded, or retired as verified commercial carbon credits.
        </p>
      </div>
    </div>
  );
}
