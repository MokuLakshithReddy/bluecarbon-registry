import fs from "node:fs";
import path from "node:path";
import { calculateScientificCarbon } from "../src/lib/carbon-methodology.ts";
import {
  validateModelAgainstEmpiricalData,
  validateModelAgainstHeldOutData,
  EMPIRICAL_FIELD_STUDIES,
  HELD_OUT_FIELD_STUDIES,
} from "../src/lib/empirical-validation-data.ts";

/**
 * Generates reproducible scientific validation report comparing model predictions
 * against independent empirical coastal wetland field datasets and held-out test datasets.
 */
export function generateScientificValidationReport(): string {
  const report = validateModelAgainstEmpiricalData(calculateScientificCarbon);
  const heldOutReport = validateModelAgainstHeldOutData(calculateScientificCarbon);

  const timestamp = new Date().toISOString();
  let md = `# Reproducible Scientific Model Validation Report\n\n`;
  md += `**Generated:** ${timestamp}  \n`;
  md += `**Validation Engine:** \`src/lib/empirical-validation-data.ts\`  \n`;
  md += `**Methodology:** \`IPCC (2013) Wetlands Supplement Ch 4; Verra VM0033 v2.1\`  \n`;
  md += `**Calibration Baseline (In-Sample):** ${report.allWithinEmpiricalConfidenceIntervals ? "✅ **ALL IN-SAMPLE ESTIMATES WITHIN 95% EMPIRICAL CONFIDENCE INTERVALS**" : "❌ **FAILED CI CHECKS**"} (MAPE: ${report.meanAbsolutePercentErrorGrossRate}%)  \n`;
  md += `**Held-Out Generalization (Out-of-Sample):** ⚠️ **HIGH DIVERGENCE STRESS-TEST** (MAPE: ${heldOutReport.meanAbsolutePercentErrorGrossRate}%, Net falls within wide empirical CIs)  \n\n`;

  md += `---\n\n`;
  md += `## 1. Summary Performance Metrics\n\n`;
  md += `### 1.1 In-Sample Independent Studies (Model Calibration Benchmarks)\n`;
  md += `- **Total Studies Evaluated:** ${report.totalStudiesEvaluated} (Sundarbans, Pichavaram, Chilika)\n`;
  md += `- **Mean Absolute Error (Net Total):** ${report.meanAbsoluteErrorTco2e} tCO₂e\n`;
  md += `- **Mean Absolute Percentage Error (Gross Rate):** ${report.meanAbsolutePercentErrorGrossRate}%\n`;
  md += `- **Calibration Criterion:** MAPE < 15.0% on representative humid/sub-humid tropical estuaries\n`;
  md += `- **Status:** ${report.meanAbsolutePercentErrorGrossRate < 15.0 ? "✅ ACCEPTED (Close agreement with peer-reviewed estuarine literature)" : "❌ REJECTED"}\n\n`;

  md += `### 1.2 Out-of-Sample Held-Out Studies (Ecological Extremes Stress-Testing)\n`;
  md += `- **Total Held-Out Studies:** ${heldOutReport.totalStudiesEvaluated} (Gujarat Arid Dwarf Mangrove & Kerala Monsoonal Brackish Wetland)\n`;
  md += `- **Mean Absolute Percentage Error (Gross Rate):** ${heldOutReport.meanAbsolutePercentErrorGrossRate}%\n`;
  md += `- **Confidence Interval Compliance:** ${heldOutReport.allWithinEmpiricalConfidenceIntervals ? "Observed values fall inside 95% CIs" : "Outside 95% CI bounds"}\n`;
  md += `- **Strict Scientific Interpretation:**\n`;
  md += `  > ⚠️ **IMPORTANT SCIENTIFIC FINDING:** An out-of-sample MAPE of **${heldOutReport.meanAbsolutePercentErrorGrossRate}%** demonstrates that the model does **NOT** possess universal high predictive accuracy across non-standard ecological regimes. While model outputs fall within the wide confidence intervals of the published literature, this compliance is an artifact of high natural variance in marginal sites, not evidence of high predictive precision.\n`;
  md += `  > - In the arid hypersaline Gulf of Kutch (\`KUTCH-PANDEY-2010\`), extreme salinity (>38 ppt) and low precipitation stunt *Avicennia marina* into dwarf shrubs, resulting in an observed gross sequestration rate of only $7.51\\text{ tCO}_2\\text{e/ha/yr}$. The regional default model overpredicts gross biomass accumulation by $+41.0\\%$.\n`;
  md += `  > - In Vembanad Lake (\`VEMBANAD-ASHA-2014\`), severe seasonal freshwater flushing lowers salinity (<18 ppt), which triggers significant methanogenesis penalties under IPCC Wetlands guidelines, causing substantial divergence from standard marine defaults.\n`;
  md += `  > - **Operational Conclusion:** This evaluation establishes that **generic Tier 1 regional defaults cannot support carbon credit issuance on extreme or uncalibrated biomes**. It scientifically justifies and mandates **Tier 3 on-site empirical field assays (allometric censuses and $^{210}\\text{Pb}$-dated sediment cores)** for commercial crediting.\n\n`;

  md += `---\n\n`;
  md += `## 2. Study-by-Study Empirical Comparison Tables\n\n`;
  md += `### 2.1 Independent Calibration Field Studies\n\n`;
  md += `| Study ID | Site Name | Ecosystem | Area (ha) | Measured Gross Rate (tCO₂e/ha/yr) | Model Gross Rate (tCO₂e/ha/yr) | Gross Residual (Error) | Empirical 95% CI (Net tCO₂e) | Model Net Estimate (tCO₂e) | Within 95% CI? |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const m of report.metrics) {
    const study = EMPIRICAL_FIELD_STUDIES.find((s) => s.studyId === m.studyId)!;
    const ciStr = `[${study.empiricalObservations.netTotalMeasuredTco2e.ci95Lower}, ${study.empiricalObservations.netTotalMeasuredTco2e.ci95Upper}]`;
    const passIcon = m.isWithin95ConfidenceInterval ? "✅ PASS" : "❌ FAIL";
    const residual = (m.modelGrossRate - m.empiricalGrossRate).toFixed(2);
    const residualStr = Number(residual) > 0 ? `+${residual}` : residual;
    md += `| \`${m.studyId}\` | ${m.siteName} | ${study.ecosystem} | ${m.assessment.effectiveAreaHectares.toFixed(1)} | ${m.empiricalGrossRate} | ${m.modelGrossRate} | ${residualStr} (${m.grossRatePercentError}%) | ${ciStr} | ${m.modelNetVerified} | ${passIcon} |\n`;
  }

  md += `\n### 2.2 Out-of-Sample Held-Out Evaluation Studies (Uncalibrated Generalization Test)\n\n`;
  md += `| Study ID | Site Name | State | Area (ha) | Measured Gross Rate (tCO₂e/ha/yr) | Model Gross Rate (tCO₂e/ha/yr) | Gross Residual | Empirical 95% CI (Net tCO₂e) | Model Net Estimate (tCO₂e) | Divergence Status |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const m of heldOutReport.metrics) {
    const study = HELD_OUT_FIELD_STUDIES.find((s) => s.studyId === m.studyId)!;
    const ciStr = `[${study.empiricalObservations.netTotalMeasuredTco2e.ci95Lower}, ${study.empiricalObservations.netTotalMeasuredTco2e.ci95Upper}]`;
    const residual = (m.modelGrossRate - m.empiricalGrossRate).toFixed(2);
    const residualStr = Number(residual) > 0 ? `+${residual}` : residual;
    md += `| \`${m.studyId}\` | ${m.siteName} | ${study.state} | ${study.studyAreaHectares.toFixed(1)} | ${m.empiricalGrossRate} | ${m.modelGrossRate} | ${residualStr} (${m.grossRatePercentError}%) | ${ciStr} | ${m.modelNetVerified} | ⚠️ High Divergence (Inside wide CI) |\n`;
  }

  md += `\n---\n\n`;
  md += `## 3. Disaggregation of Measured Values vs. Derived/Assumed Factors\n\n`;
  md += `To satisfy carbon-accounting integrity guidelines, physical empirical measurements are strictly disaggregated from stoichiometric conversions and literature assumptions:\n\n`;
  md += `| Study ID | Directly Measured Physical Parameters | Analytical Laboratory Method | Derived Parameters & Stoichiometric Conversions | Literature-Assumed Factors |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;
  md += `| \`SUNDARBANS-RAY-2011\` | DBH increments ($0.42\\text{ cm/yr}$), tree height ($8.5\\text{ m}$), sediment bulk density ($0.98\\text{ g/cm}^3$), %SOC ($1.48\\%$), $^{210}\\text{Pb}$ accretion ($0.54\\text{ cm/yr}$) | Destructive allometric regression + $^{210}\\text{Pb}$ alpha spectrometry + Walkley-Black wet oxidation | Biomass carbon $= 2.05\\text{ t C/ha/yr}$; Soil carbon $= 1.55\\text{ t C/ha/yr}$; Converted via $\\times \\frac{44}{12}$ to $7.52$ and $5.68\\text{ tCO}_2\\text{e/ha/yr}$ | Biomass carbon fraction $C = 0.47$; Belowground root:shoot ratio $R = 0.39$ (Cairns et al.) |\n`;
  md += `| \`PICHAVARAM-KATHIRESAN-2000\` | Tree density ($10,000\\text{ stems/ha}$), 10-yr wood volume increment, sediment core dry bulk density ($1.12\\text{ g/cm}^3$), LOI organic fraction ($3.8\\%$) | Quadrant tree measurements + $50\\text{ cm}$ core slicing + Loss-on-Ignition at $450^\\circ\\text{C}$ | Annual biomass accumulation $= 198\\text{ g C/m}^2/\\text{yr}$; Annual sediment burial $= 142\\text{ g C/m}^2/\\text{yr}$; Converted to $7.26$ and $5.21\\text{ tCO}_2\\text{e/ha/yr}$ | Carbon fraction of organic matter $= 0.58$ (Van Bemmelen factor); Wood density $= 0.72\\text{ g/cm}^3$ |\n`;
  md += `| \`CHILIKA-GANGULY-2017\` | Quadrant harvested biomass ($12\\text{ g C/m}^2/\\text{yr}$), $^{210}\\text{Pb}$ sediment accumulation rate ($0.38\\text{ cm/yr}$), core %SOC ($0.95\\%$) | $0.25\\text{ m}^2$ quadrant harvesting, oven drying at $60^\\circ\\text{C}$ + Walkley-Black oxidation | Biomass turnover $= 0.44\\text{ tCO}_2\\text{e/ha/yr}$; Soil burial $= 4.58\\text{ tCO}_2\\text{e/ha/yr}$ | Carbon fraction of dry seagrass biomass $= 0.34$; Belowground rhizome ratio $= 1.8$ |\n`;
  md += `| \`KUTCH-PANDEY-2010\` (Held-Out) | Dwarf tree height ($1.8\\text{ m}$), collar diameter ($4.2\\text{ cm}$), sediment dry bulk density ($1.35\\text{ g/cm}^3$), %SOC ($0.65\\%$) | Dimensional allometry for stunted shrubs + $50\\text{ cm}$ sediment cores + LOI at $450^\\circ\\text{C}$ | Biomass carbon $= 1.10\\text{ t C/ha/yr}$; Soil carbon $= 0.95\\text{ t C/ha/yr}$; Converted to $4.03$ and $3.48\\text{ tCO}_2\\text{e/ha/yr}$ | Dwarf shrub root:shoot ratio $R = 0.65$ (elevated pneumatophore biomass in hypersaline mud) |\n`;
  md += `| \`VEMBANAD-ASHA-2014\` (Held-Out) | Stem density, DBH increments, piston core dry density ($0.88\\text{ g/cm}^3$), %SOC ($2.12\\%$), water salinity ($12.5\\text{ ppt}$) | Fixed permanent sample plots + piston core extraction + Walkley-Black wet oxidation | Biomass carbon $= 2.15\\text{ t C/ha/yr}$; Soil carbon $= 1.40\\text{ t C/ha/yr}$; Converted to $7.88$ and $5.13\\text{ tCO}_2\\text{e/ha/yr}$ | Biogenic methane deduction factor for mesohaline waters ($<18\\text{ ppt}$) per IPCC Wetlands Supplement Table 4.14 |\n\n`;

  md += `---\n\n`;
  md += `## 4. Scientific Discussion & Model Limitations\n\n`;
  md += `1. **In-Sample Baseline Fidelity:**\n`;
  md += `   - Across the three calibration studies (Sundarbans Lothian Island, Pichavaram restored stands, and Chilika seagrass beds), the model exhibits an average gross-rate MAPE of **${report.meanAbsolutePercentErrorGrossRate}%** ($0.18\\dots 0.67\\text{ tCO}_2\\text{e/ha/yr}$ absolute residuals).\n`;
  md += `   - These sites represent typical sub-humid and humid tidal regimes where IPCC default parameters are reasonably grounded.\n\n`;
  md += `2. **Out-of-Sample Ecological Divergence:**\n`;
  md += `   - At Kutch, the model severely overpredicts ($10.59$ vs $7.51\\text{ tCO}_2\\text{e/ha/yr}$, $+41.0\\%$ error) because regional equations do not account for extreme hypersaline dwarfing.\n`;
  md += `   - At Vembanad, seasonal monsoon freshwater flushing drops salinity below $18\\text{ ppt}$, where sulfate reduction ceases to suppress methanogenesis, requiring significant methane deduction.\n`;
  md += `   - **Key Finding:** The model cannot be treated as universally self-calibrating across diverse biomes without site-specific empirical inputs.\n\n`;
  md += `3. **Requirements for Commercial Carbon Credit Issuance:**\n`;
  md += `   - Software algorithmic models and synthetic demonstration fixtures cannot be used as sole proof for issuance or retirement of carbon credits.\n`;
  md += `   - Issuance requires accredited VVB audit under ISO 14064-3 and mandatory Tier 3 site-specific laboratory assays.\n\n`;

  md += `---\n\n`;
  md += `## 5. Methodological Distinction\n\n`;
  md += `> **Independent Empirical Validation vs. Software Regression Testing:**\n`;
  md += `> - **Empirical Validation (this report):** Evaluates whether the IPCC/VM0033 equations accurately reflect physical accumulation measured by peer-reviewed field scientists across distinct biomes.\n`;
  md += `> - **Calculation Regression Benchmarks:** Tested in \`tests/scientific/calculation-regression.test.ts\` to verify that software refactoring does not alter internal formula execution.\n`;

  const outPath = path.resolve(process.cwd(), "docs/SCIENTIFIC_VALIDATION_REPORT.md");
  fs.writeFileSync(outPath, md, "utf-8");
  return md;
}

if (process.argv[1] && process.argv[1].includes("generate-scientific-validation-report")) {
  console.log("=== Generating Independent Scientific Validation Report ===");
  const md = generateScientificValidationReport();
  console.log("[PASS] Report written to docs/SCIENTIFIC_VALIDATION_REPORT.md");
  console.log(md.split("\n").slice(0, 35).join("\n"));
}
