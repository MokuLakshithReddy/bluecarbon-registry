import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "ocean" | "teal" | "leaf" | "warning";
  className?: string;
}) {
  const toneRing: Record<string, string> = {
    default: "text-primary bg-primary/10",
    ocean: "text-ocean bg-ocean/10",
    teal: "text-teal bg-teal/15",
    leaf: "text-leaf bg-leaf/15",
    warning: "text-warning-foreground bg-warning/20",
  };
  return (
    <div className={cn("panel p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
        {icon ? (
          <span className={cn("flex size-8 items-center justify-center rounded-lg", toneRing[tone])}>{icon}</span>
        ) : null}
      </div>
      <p className="mt-3 font-display text-2xl font-semibold text-foreground sm:text-[1.7rem]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal">{eyebrow}</p>
        ) : null}
        <h2 className="mt-1 font-display text-xl font-semibold text-foreground sm:text-2xl">{title}</h2>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
