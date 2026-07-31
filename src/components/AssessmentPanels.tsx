import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import type { ValidationResult } from "@/lib/validation-engine";
import type { ScreeningResult } from "@/lib/ai-screening";
import { RiskBadge, ScorePill } from "./StatusBadge";

export function ValidationPanel({ result }: { result: ValidationResult }) {
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Automated Validation
          </p>
          <h3 className="mt-1 font-display text-lg font-semibold">Evidence Quality Score</h3>
        </div>
        <ScorePill score={result.score} />
      </div>
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-gradient-deep transition-all"
          style={{ width: `${result.score}%` }}
        />
      </div>
      <ul className="mt-4 divide-y divide-border">
        {result.checks.map((check) => (
          <li key={check.key} className="flex items-start gap-3 py-2.5">
            {check.state === "PASS" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            ) : check.state === "WARN" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{check.label}</p>
              <p className="text-xs text-muted-foreground">{check.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RiskPanel({ result }: { result: ScreeningResult }) {
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            AI-Assisted / Automated Screening
          </p>
          <h3 className="mt-1 font-display text-lg font-semibold">Risk Assessment</h3>
        </div>
        <RiskBadge level={result.risk_level} />
      </div>
      <ul className="mt-4 space-y-2">
        {result.findings.map((finding, index) => (
          <li key={index} className="flex items-start gap-2 text-sm">
            {finding.state === "OK" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            )}
            <span className={finding.state === "OK" ? "text-muted-foreground" : "text-foreground"}>
              {finding.message}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2 rounded-lg border border-border bg-secondary/60 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ocean" />
        <p>
          {result.summary} Screening is rule-based and deterministic — it assists but never replaces the
          human/NCCR verification decision.
        </p>
      </div>
    </div>
  );
}
