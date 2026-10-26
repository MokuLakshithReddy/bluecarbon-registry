# Reference Research Project Case: Lothian Island Mangrove Restoration

**Case Identifier:** `REF-SUNDARBANS-LOTHIAN-2024-V1`  
**Location:** Lothian Island Wildlife Sanctuary, South 24 Parganas, Sundarbans Biosphere Reserve, West Bengal, India  
**Centroid Coordinates:** `21.8542° N, 88.3245° E` (WGS84 EPSG:4326)  
**Project Typology:** Restored Tidal Mangrove Wetland (Afforestation & Assisted Natural Regeneration)  
**Scientific Reference Baseline:** Ray et al. (2011), _Estuarine, Coastal and Shelf Science_ 95:394–402; Ray et al. (2011), _Atmospheric Environment_ 45(28): 5016–5024.

---

## 1. Executive Summary

This reference case provides an end-to-end, reproducible research study demonstrating how raw ecological observations, calibrated satellite imagery, signed IoT telemetry, and laboratory assays are synthesized into a verified blue carbon estimate within the BlueCarbon Registry architecture.

Every parameter in this case is grounded in traceable field survey protocols and can be audited programmatically against real, on-disk data files in `data/reference-case/` with byte-exact cryptographic hashes.

---

## 2. Spatial & Temporal Project Boundaries

### 2.1 Project Area Polygon (WGS84 GeoJSON Coordinates)

The project boundary encompasses a 100.0-hectare intertidal mudflat parcel along the fringe of Lothian Island Wildlife Sanctuary, centered at `21.8542° N, 88.3245° E`:

```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [88.319655, 21.849704],
      [88.329345, 21.849704],
      [88.329345, 21.858696],
      [88.319655, 21.858696],
      [88.319655, 21.849704]
    ]
  ]
}
```

_Geodesic Area Reconciliation:_

- **Longitudinal Span:** $88.329345° - 88.319655° = 0.009690° \approx 1,000.0\text{ m}$ (at $21.8542°\text{ N}$).
- **Latitudinal Span:** $21.858696° - 21.849704° = 0.008992° \approx 1,000.0\text{ m}$.
- **Spherical Geodesic Area:** **100.00 hectares** ($1,000,000\text{ m}^2$), calculated via `calculateGeodesicPolygonAreaHectares()` using WGS84 authalic mean radius ($R = 6,371,008.8\text{ m}$).
- _Note on Historical Discrepancy:_ An earlier exploratory bounding box spanning $88.318°$ to $88.332°$ (~~$1.45\text{ km}$) by $21.848°$ to $21.860°$ (~~$1.33\text{ km}$) measured ~193 hectares. The polygon coordinates have been recalculated and reconciled so that the stated boundary geometry, geodesic integration, and 100.0 ha project area agree exactly.

### 2.2 Monitoring Period

- **Restoration Planting / Baseline Date:** `2023-01-01T00:00:00Z`
- **Monitoring Verification Date:** `2025-01-01T00:00:00Z`
- **Elapsed Duration ($T$):** **2.00 years** (731 days, leap-year adjusted).

---

## 3. Structured Evidence Manifest

To qualify for **Tier 3 (Comprehensive Site Calibration)**, the project developer submitted structured evidence packages meeting all requirements of `IPCC-WETLANDS-2013-VM0033-V2.1`. Each file exists on disk, and its SHA-256 hash is computed directly from raw file bytes:

| Evidence ID              | Evidence Type                    | Source File & Protocol                                                                                                                                                                                                                                                                    | Timestamp            | SHA-256 Hash (Byte-Exact)                                          | Authoritative Verifier Endorsement                                                        |
| :----------------------- | :------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------- | :----------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| `EVD-LOTH-2024-SOC-01`   | `SOIL_CORE_ORGANIC_CARBON_ASSAY` | [`data/reference-case/lothian-sediment-cores-2024.csv`](../data/reference-case/lothian-sediment-cores-2024.csv). 12 depth-stratified sediment core segments (0–100 cm depth). Loss-on-Ignition (LOI 550°C) & Walkley-Black dry combustion. Mean SOC = 1.48% wt.                           | 2024-11-15T09:30:00Z | `fa5da4b858f22e1fef6778e63c58a293dc619dcc06ab21ecbc357bd317bf1222` | Verifier ID: `nccr-auditor-dr-das`<br>Review ID: `rev-2024-loth-01`<br>Status: `VERIFIED` |
| `EVD-LOTH-2024-ALLOM-02` | `ALLOMETRIC_GROWTH_SURVEY`       | [`data/reference-case/lothian-allometric-census-2024.csv`](../data/reference-case/lothian-allometric-census-2024.csv). Permanent circular sample plots. Measured DBH, tree height, and canopy cover. 17 alive / 3 dead = 85.0% survival rate.                                             | 2024-12-01T14:15:00Z | `d09319bc3a757072bad3a448cd03d5382f6e7536ed5d4f7fb8fee051e2d31584` | Verifier ID: `nccr-auditor-dr-das`<br>Review ID: `rev-2024-loth-01`<br>Status: `VERIFIED` |
| `EVD-LOTH-2024-NDVI-03`  | `MULTISPECTRAL_RASTER`           | [`data/reference-case/lothian-sentinel2-surface-reflectance-2024.json`](../data/reference-case/lothian-sentinel2-surface-reflectance-2024.json). European Space Agency (ESA) Sentinel-2A Level-2A BOA reflectance. Mean project NDVI = 0.742 ($\pm 0.041$).                               | 2024-12-10T04:47:11Z | `d9ee35742bdf357917989308dc459c1e155ab9c92bbdcc4e952ed93faef866d1` | Verifier ID: `nccr-auditor-dr-das`<br>Review ID: `rev-2024-loth-01`<br>Status: `VERIFIED` |
| `EVD-LOTH-2024-IOT-04`   | `CALIBRATED_SENSOR_TELEMETRY`    | [`data/reference-case/lothian-ysi-telemetry-2024.json`](../data/reference-case/lothian-ysi-telemetry-2024.json). In-situ YSI EXO2 multiparameter sonde at Lothian Jetty. Continuous conductivity/salinity logging. Mean salinity = 24.5 ppt (min 21.2, max 28.6). Secp256k1 ECDSA signed. | 2024-12-20T18:00:00Z | `ea5e411e673ca1b47b153460f9435b6897b0ad010e583eb79a843869c838a79b` | Verifier ID: `nccr-auditor-dr-das`<br>Review ID: `rev-2024-loth-01`<br>Status: `VERIFIED` |

> [!NOTE]
> **Data Authenticity & Standardized Research Fixture Scope:**
> The reference case files provide reproducible, byte-exact, cryptographically signed fixtures for end-to-end integration and MRV pipeline validation. Their parameters are mathematically grounded in peer-reviewed field literature (Ray et al. 2011, IPCC 2013). Cryptographic hash integrity proves that file bytes match the recorded digest, and the secp256k1 ECDSA signature proves device key possession; in a live commercial registry, physical authenticity of field observations requires on-site chain-of-custody verification by an accredited third-party VVB.

---

## 4. Step-by-Step Carbon Accounting Derivation

### 4.1 Input Parameters

| Parameter                        | Symbol                | Value                                           | Justification / Source                                                                |
| :------------------------------- | :-------------------- | :---------------------------------------------- | :------------------------------------------------------------------------------------ |
| Project Area                     | $A$                   | $100.0\text{ ha}$                               | Geodesic polygon GIS analysis                                                         |
| Project Duration                 | $T$                   | $2.0\text{ yr}$                                 | Difference between start date (`2023-01-01`) and monitoring date (`2025-01-01`)       |
| Ecosystem                        | -                     | `MANGROVE`                                      | IPCC (2013) Table 4.4 & 4.11 regional parameters                                      |
| Biomass Sequestration Rate       | $R_{\text{bio}}$      | $7.80\text{ tCO}_2\text{e}/\text{ha}/\text{yr}$ | Ray et al. (2011) _Avicennia_ biomass accumulation                                    |
| Sapling Survival Rate            | $S_{\text{rate}}$     | $0.85$ (85%)                                    | Field allometric plot survey `EVD-LOTH-2024-ALLOM-02` (17/20 alive)                   |
| Soil Accretion Rate              | $R_{\text{soil}}$     | $5.90\text{ tCO}_2\text{e}/\text{ha}/\text{yr}$ | Intertidal sediment trapping (Ray et al. 2011 LOI cores)                              |
| Water Salinity                   | -                     | $24.5\text{ ppt}$                               | In-situ telemetry sonde `EVD-LOTH-2024-IOT-04`                                        |
| Methane Deduction Rate           | $D_{\text{CH}_4}$     | $0.00\text{ tCO}_2\text{e}$                     | Suppressed (salinity $\ge 18.0\text{ ppt}$)                                           |
| Activity Leakage                 | $D_{\text{leakage}}$  | $0.00\text{ tCO}_2\text{e}$                     | Protected sanctuary reserve (zero displacement)                                       |
| Non-Permanence Risk Buffer       | $B_{\text{reversal}}$ | $15.0\%$ (0.15)                                 | Verra AFOLU Risk Tool mandatory buffer                                                |
| Scientific Uncertainty Deduction | $U_{\text{discount}}$ | $3.0\%$ (0.03)                                  | Tier 3 verified soil cores + allometric plots with authoritative verifier endorsement |

### 4.2 Mathematical Execution

#### Step 1: Gross Sequestration

$$C_{\text{gross}} = A \times T \times \Big( (R_{\text{bio}} \times S_{\text{rate}}) + R_{\text{soil}} \Big)$$
$$C_{\text{gross}} = 100.0 \times 2.0 \times \Big( (7.80 \times 0.85) + 5.90 \Big)$$
$$C_{\text{gross}} = 200.0 \times (6.63 + 5.90) = 200.0 \times 12.53 = \mathbf{2,506.00\text{ tCO}_2\text{e}}$$

#### Step 2: Methane and Leakage Deductions

- Since $\text{salinity} = 24.5\text{ ppt} \ge 18.0\text{ ppt}$, $D_{\text{CH}_4} = 0.00$.
- Leakage is false: $D_{\text{leakage}} = 0.00$.
  $$\text{Gross Minus Emissions & Leakage} = 2,506.00 - 0.00 - 0.00 = \mathbf{2,506.00\text{ tCO}_2\text{e}}$$

#### Step 3: Non-Permanence Risk Buffer Allocation

$$\text{Buffer Allocation} = 2,506.00 \times 0.15 = \mathbf{375.90\text{ tCO}_2\text{e}}$$
$$\text{Net Post-Buffer} = 2,506.00 - 375.90 = \mathbf{2,130.10\text{ tCO}_2\text{e}}$$

#### Step 4: Scientific Uncertainty Deduction

$$\text{Tier 3 Deduction} = 2,130.10 \times 0.03 = \mathbf{63.903\text{ tCO}_2\text{e}}$$
$$\text{Net Model Estimate} = 2,130.10 \times (1 - 0.03) = \mathbf{2,066.20\text{ tCO}_2\text{e}}$$

---

## 5. Executable Code Verification

The following code is tested automatically in the repository's test suite ([`tests/scientific/reference-case.test.ts`](../tests/scientific/reference-case.test.ts)):

```typescript
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  calculateScientificCarbon,
  createAuthoritativeVerifierDecision,
  CarbonCalculationInput,
} from "../src/lib/carbon-methodology";

// 1. Read real evidence files from disk and verify byte hashes
const baseDir = path.resolve(process.cwd(), "data/reference-case");
const socBytes = fs.readFileSync(path.join(baseDir, "lothian-sediment-cores-2024.csv"));
const allomBytes = fs.readFileSync(path.join(baseDir, "lothian-allometric-census-2024.csv"));

const socHash = crypto.createHash("sha256").update(socBytes).digest("hex");
const allomHash = crypto.createHash("sha256").update(allomBytes).digest("hex");

// 2. Build authoritative verifier endorsements
const verifier = {
  id: "nccr-auditor-dr-das",
  role: "VERIFIER" as const,
  reviewId: "rev-2024-loth-01",
};

const lothianCaseInput: CarbonCalculationInput = {
  ecosystem: "MANGROVE",
  areaHectares: 100.0,
  restorationStartDate: "2023-01-01T00:00:00Z",
  restorationEndDate: "2025-01-01T00:00:00Z",
  salinityPpt: 24.5,
  survivalRate: 85.0,
  hasLeakageDisplacement: false,
  tier: "TIER_3_SOIL_CORES",
  mode: "STRICT_VERIFICATION",
  structuredEvidence: [
    {
      evidenceId: "EVD-LOTH-2024-SOC-01",
      type: "SOIL_CORE_ORGANIC_CARBON_ASSAY",
      uri: "file://data/reference-case/lothian-sediment-cores-2024.csv",
      sha256Hash: socHash,
      issuer: "ICAR-CIFRI Estuarine Division",
      collectionDate: "2024-11-15T09:30:00Z",
      laboratoryMethod: "Loss-on-Ignition (LOI 550C) & Walkley-Black dry combustion",
      coordinateReferenceSystem: "EPSG:4326",
      verificationStatus: "VERIFIED",
      authoritativeDecision: createAuthoritativeVerifierDecision({ sha256Hash: socHash }, verifier),
    },
    {
      evidenceId: "EVD-LOTH-2024-ALLOM-02",
      type: "ALLOMETRIC_GROWTH_SURVEY",
      uri: "file://data/reference-case/lothian-allometric-census-2024.csv",
      sha256Hash: allomHash,
      issuer: "Botanical Survey of India & WBFD",
      collectionDate: "2024-12-01T14:15:00Z",
      verificationStatus: "VERIFIED",
      authoritativeDecision: createAuthoritativeVerifierDecision(
        { sha256Hash: allomHash },
        verifier,
      ),
    },
  ],
};

const result = calculateScientificCarbon(lothianCaseInput);

// Assertions
assert.strictEqual(result.tier, "Tier 3 (Site-Specific Soil Cores & Allometry)");
assert.strictEqual(result.grossSequestrationTco2e, 2506.0);
assert.strictEqual(result.riskBufferDeductionTco2e, 375.9);
assert.strictEqual(result.netModelEstimateTco2e, 2066.2);
```

---

## 6. Audit Trail & Registry Invariants

1. **Authoritative Reviewer Enforcement:** A client-submitted `verificationStatus: "VERIFIED"` is rejected in `STRICT_VERIFICATION` mode unless bound to an authentic `authoritativeDecision` containing the verifier's authenticated identity and matching the exact SHA-256 hash of the evidence bytes.
2. **Deterministic Cryptographic Anchoring:** When approved by a licensed verifier, the complete JSON payload—including all input parameters, evidence IDs, byte hashes, and calculated metrics—is committed to the database and anchored on-chain via `RecordAnchored` events in `BlueCarbonRegistry.sol`.
3. **External Scientific Review Requirement:** Model calculations provide auditable, reproducible MRV telemetry. Formal financial credit issuance requires third-party validation by an accredited Designated Operational Entity (DOE).
