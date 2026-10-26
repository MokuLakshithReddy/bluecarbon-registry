# Reproducible Scientific Model Validation Report

**Generated:** 2026-10-26T09:12:01.590Z  
**Validation Engine:** `src/lib/empirical-validation-data.ts`  
**Model Specification:** `IPCC-WETLANDS-2013-VM0033-V2.1`  
**Overall Result:** ✅ **ALL PREDICTIONS WITHIN 95% EMPIRICAL CONFIDENCE INTERVALS**

---

## 1. Summary Performance Metrics

- **Total Independent Studies Evaluated:** 3
- **Mean Absolute Error (Net Total):** 16.16 tCO₂e
- **Mean Absolute Percentage Error (Gross Rate):** 4.1%
- **Acceptance Threshold:** MAPE < 15.0% for Tier-1/Tier-2 regional blue carbon models
- **Status:** ✅ ACCEPTED (Within acceptable scientific precision bounds)

---

## 2. Study-by-Study Empirical Comparison Table

| Study ID                     | Site Name                                                       | Ecosystem | Area (ha) | Measured Gross Rate (tCO₂e/ha/yr) | Model Gross Rate (tCO₂e/ha/yr) | Gross Residual (Error) | Empirical 95% CI (Net tCO₂e) | Model Net Estimate (tCO₂e) | Within 95% CI? |
| :--------------------------- | :-------------------------------------------------------------- | :-------- | :-------- | :-------------------------------- | :----------------------------- | :--------------------- | :--------------------------- | :------------------------- | :------------- |
| `SUNDARBANS-RAY-2011`        | Lothian Island Wildlife Sanctuary, Sundarbans Biosphere Reserve | MANGROVE  | 50.0      | 13.2                              | 12.53                          | -0.67 (5.1%)           | [1250, 1590]                 | 1437.82                    | ✅ PASS        |
| `PICHAVARAM-KATHIRESAN-2000` | Pichavaram Mangrove Estuary Complex, Coleroon River             | MANGROVE  | 20.0      | 12.47                             | 12.92                          | +0.45 (3.6%)           | [360, 450]                   | 395.35                     | ✅ PASS        |
| `CHILIKA-GANGULY-2017`       | Chilika Lagoon Brackish Water Seagrass Meadow                   | SEAGRASS  | 100.0     | 5.02                              | 5.2                            | +0.18 (3.6%)           | [1820, 2200]                 | 1989                       | ✅ PASS        |

---

## 3. Scientific Discussion & Model Limitations

1. **Mangrove Biomass & Soil Accretion:**
   - At Sundarbans Lothian Island (`SUNDARBANS-RAY-2011`), the model predicted a gross annual rate of $12.53\text{ tCO}_2\text{e/ha/yr}$ compared to the observed $13.20\text{ tCO}_2\text{e/ha/yr}$ (residual $-0.67\text{ tCO}_2\text{e/ha/yr}$, $5.08\%$ relative error).
   - The model estimate lies comfortably within the reported $95\%$ confidence interval $[11.8, 14.6]$.
2. **Pichavaram Restored Stands:**
   - At Pichavaram (`PICHAVARAM-KATHIRESAN-2000`), the model predicted $12.92\text{ tCO}_2\text{e/ha/yr}$ compared to the observed $12.47\text{ tCO}_2\text{e/ha/yr}$ ($+0.45\text{ tCO}_2\text{e/ha/yr}$, $3.61\%$ relative error).
3. **Chilika Lagoon Seagrass Meadows:**
   - At Chilika (`CHILIKA-GANGULY-2017`), the model predicted $5.20\text{ tCO}_2\text{e/ha/yr}$ vs observed $5.02\text{ tCO}_2\text{e/ha/yr}$ ($+0.18\text{ tCO}_2\text{e/ha/yr}$, $3.59\%$ relative error).
4. **Known Scientific Limitations:**
   - Model coefficients assume stable tidal exchange. Hypersalinity events or severe sediment starvation from upstream damming can reduce soil accretion below the IPCC default ($5.9\text{ tCO}_2\text{e/ha/yr}$).
   - High-energy exposed coastal zones with active wave erosion require localized allometric adjustments.

---

## 4. Methodological Distinction

> **Independent Empirical Validation vs. Software Regression Testing:**
>
> - **Empirical Validation (this report):** Evaluates whether the IPCC/VM0033 equations and regional parameters accurately reflect real-world physical accumulation measured by peer-reviewed field scientists.
> - **Calculation Regression Benchmarks:** Tested in `tests/scientific/calculation-regression.test.ts` to verify that software refactoring does not alter internal formula execution.
