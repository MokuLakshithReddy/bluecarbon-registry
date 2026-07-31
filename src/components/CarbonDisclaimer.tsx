import { Info } from "lucide-react";
import { CARBON_DISCLAIMER } from "@/lib/domain";
import { cn } from "@/lib/utils";

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
