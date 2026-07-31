import { cn } from "@/lib/utils";
import { STATUS_LABEL, type ProjectStatus } from "@/lib/domain";

const STATUS_STYLES: Record<ProjectStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground border-border",
  SUBMITTED: "bg-info/10 text-info border-info/30",
  UNDER_REVIEW: "bg-warning/15 text-warning-foreground border-warning/40",
  CORRECTION_REQUIRED: "bg-warning/20 text-warning-foreground border-warning/50",
  VERIFIED: "bg-success/12 text-success border-success/35",
  REJECTED: "bg-destructive/10 text-destructive border-destructive/30",
};

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
        STATUS_STYLES[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </span>
  );
}

const RISK_STYLES: Record<string, string> = {
  LOW: "bg-success/12 text-success border-success/35",
  MEDIUM: "bg-warning/20 text-warning-foreground border-warning/50",
  HIGH: "bg-destructive/10 text-destructive border-destructive/30",
};

export function RiskBadge({ level, className }: { level: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
        RISK_STYLES[level] ?? RISK_STYLES.LOW,
        className,
      )}
    >
      {level} risk
    </span>
  );
}

export function ScorePill({ score }: { score: number }) {
  const tone =
    score >= 85
      ? "bg-success/12 text-success border-success/35"
      : score >= 65
        ? "bg-warning/20 text-warning-foreground border-warning/50"
        : "bg-destructive/10 text-destructive border-destructive/30";
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold", tone)}>
      {score} / 100
    </span>
  );
}
