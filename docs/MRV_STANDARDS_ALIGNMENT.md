# MRV Standards Alignment Matrix & Regulatory Compliance

## 1. Executive Summary

This document establishes the technical and methodological alignment of the **BlueCarbon Registry** with premier international and national carbon standards:

1. **Verra VM0033**: Methodology for Tidal Wetland and Seagrass Restoration (v2.1).
2. **Verra VM0007**: REDD+ Methodology Framework (for coastal mangrove conservation).
3. **Plan Vivo Foundation**: Standards for Community-Led Coastal Conservation & Ecosystem Services.
4. **Indian Carbon Credit Trading Scheme (CCTS)**: National regulatory framework administered by the Bureau of Energy Efficiency (BEE) and Ministry of Power / MoEFCC.

---

## 2. Standards Alignment Matrix

| Parameter / Requirement             | International Standard (Verra VM0033 / IPCC 2013)                                                                             | BlueCarbon Registry Implementation                                                                                           | Verification Mechanism                                                                                                       |
| :---------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| **Biomass Growth Rate**             | IPCC 2013 Table 4.4: 7.80 tCO2e/ha/yr biomass; Gross Annual Rate: 13.70 tCO2e/ha/yr (7.80 biomass + 5.90 soil accretion)      | `SCIENTIFIC_CARBON_COEFFICIENTS.MANGROVE`: `biomassRate = 7.80`, `soilAccretionRate = 5.90`, `grossRate = 13.70` tCO2e/ha/yr | Programmatic coefficients in `src/lib/carbon-methodology.ts`                                                                 |
| **Soil Carbon Accretion**           | 5.9 tCO2e/ha/yr soil organic carbon accumulation                                                                              | Separately tracked pool in `calculateScientificCarbon`                                                                       | Independent soil core organic carbon laboratory reports                                                                      |
| **Methane (CH4) GHG Deduction**     | IPCC 2013 Table 4.14: 5.42 tCO2e/ha/yr deduction when salinity < 18 ppt                                                       | `salinityPpt < 18` triggers mandatory 5.42 tCO2e deduction                                                                   | IoT conductivity sensor telemetry with ECDSA signatures                                                                      |
| **Non-Permanence Buffer Pool**      | Verra AFOLU Risk Tool: 10–20% risk buffer withholding                                                                         | 15% automatic buffer pool allocation on-chain (`BUFFER_POOL_PERCENT = 15`)                                                   | On-chain contract `mintCreditBatch` reserves 15% in unspendable buffer pool                                                  |
| **Tiered Evidence Requirement**     | Tier 1: Defaults (10% uncertainty); Tier 2: Site calibrated (5% uncertainty); Tier 3: Allometry & soil cores (3% uncertainty) | Programmatic downgrade to Tier 1 if structured evidence is absent or invalid                                                 | Checked in `calculateScientificCarbon` via structured `evidenceItems` requiring verified soil cores and allometry for Tier 3 |
| **Territorial Double-Registration** | Strict geographical boundary exclusivity                                                                                      | Polygon vertex validation & ray-casting collision check                                                                      | `validateProjectBoundary()` in `src/lib/geo-boundary-validator.ts`                                                           |
| **Multispectral Spectral Anomaly**  | Plausibility checks against optical NDVI/EVI rasters                                                                          | Zod schema bounds `[-1.0, 1.0]` + physiological ceiling (> 35 tCO2e/ha/yr flagged)                                           | `checkSequestrationAnomaly()` in `src/lib/multispectral-validation.ts`                                                       |
| **Retirement & Double Counting**    | Irreversible retirement with named beneficiary details                                                                        | On-chain `retireCredits` burns circulating balance and generates unique Certificate ID                                       | Deterministic `certificateId` emitted in `CreditsRetired` event                                                              |
| **AML/KYC Compliance**              | Digital asset compliance & sanction screening                                                                                 | Tiered KYC gating with FATF/OFAC high-risk jurisdiction blocklist                                                            | `assertKycEligibleForTransaction()` in `src/lib/kyc-compliance.ts`                                                           |

---

## 3. Decentralized Storage Evidence Verification

All project evidence packs must be pinned to IPFS (`ipfs://bafy...`) or Arweave (`ar://...`).
The manifest must contain:

1. High-resolution orthomosaic GeoTIFF rasters.
2. Calibrated multispectral NDVI vegetation rasters.
3. Laboratory test results for soil organic carbon percentage (Walkley-Black or Loss-on-Ignition method).
4. Signed independent validation report from accredited third-party auditing entity (e.g. NCCR / ICAR-CIFRI).
