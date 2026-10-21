import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle, Leaf, BookOpen } from "lucide-react";
import type { ValidationResult } from "@/lib/validation-engine";
import type { ScreeningResult } from "@/lib/ai-screening";
import { calculateScientificCarbon, type DetailedCarbonAssessment } from "@/lib/carbon-methodology";
import type { Ecosystem } from "@/lib/domain";
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
          {result.summary} Screening is rule-based and deterministic — it assists but never replaces
          the human/NCCR verification decision.
        </p>
      </div>
    </div>
  );
}

export function CarbonMethodologyPanel({
  ecosystem,
  areaHectares,
  restorationStart,
  restorationEnd,
  survivalRate,
}: {
  ecosystem: Ecosystem;
  areaHectares: number;
  restorationStart?: string | null;
  restorationEnd?: string | null;
  survivalRate?: number | null;
}) {
  const assessment: DetailedCarbonAssessment = calculateScientificCarbon({
    ecosystem,
    areaHectares,
    restorationStartDate: restorationStart,
    restorationEndDate: restorationEnd,
    survivalRate,
  });

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Scientific Accounting
          </p>
          <h3 className="mt-1 font-display text-lg font-semibold flex items-center gap-2">
            <Leaf className="size-4 text-emerald-500" />
            IPCC Wetlands / VM0033 Accounting
          </h3>
        </div>
        <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
          {assessment.tier}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
        <div className="rounded-lg bg-secondary/50 p-3 space-y-1">
          <p className="font-semibold text-foreground">Gross Sequestration</p>
          <p className="text-muted-foreground">
            Biomass: {assessment.biomassSequestrationTco2e.toLocaleString()} tCO₂e
          </p>
          <p className="text-muted-foreground">
            Soil Accumulation: {assessment.soilCarbonAccretionTco2e.toLocaleString()} tCO₂e
          </p>
          <p className="font-semibold text-emerald-600 dark:text-emerald-400 pt-1">
            Total Gross: {assessment.grossSequestrationTco2e.toLocaleString()} tCO₂e
          </p>
        </div>

        <div className="rounded-lg bg-secondary/50 p-3 space-y-1">
          <p className="font-semibold text-foreground">Mandatory Deductions &amp; Buffer</p>
          <p className="text-muted-foreground">
            Non-Permanence Buffer (15%): -{assessment.riskBufferDeductionTco2e.toLocaleString()}{" "}
            tCO₂e
          </p>
          <p className="text-muted-foreground">
            Uncertainty Discount: -{assessment.uncertaintyDiscountTco2e.toLocaleString()} tCO₂e
          </p>
          <p className="font-semibold text-primary pt-1">
            Net Model Estimate: {assessment.netVerifiedTco2e.toLocaleString()} tCO₂e
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="space-y-1">
          <p>
            <span className="font-semibold text-foreground">Scientific Reference: </span>
            {assessment.citation}. Calculated over {assessment.durationYears} year(s) with{" "}
            {assessment.survivalRatePercent}% survival factor.
          </p>
          <p className="text-[0.7rem] text-amber-600 dark:text-amber-400 font-medium">
            {assessment.unaccreditedDisclaimer}
          </p>
        </div>
      </div>
    </div>
  );
}
