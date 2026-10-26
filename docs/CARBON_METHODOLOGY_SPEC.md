# Blue Carbon MRV Scientific Accounting Methodology Specification

**Standard Identifier:** `IPCC-WETLANDS-2013-VM0033-V2.1`  
**Version:** 2.1.0  
**Governing Protocols:**

- **IPCC (2013):** _2013 Supplement to the 2006 IPCC Guidelines for National Greenhouse Gas Inventories: Wetlands_ (Chapter 4: Coastal Wetlands).
- **Verra (VCS) VM0033:** _Methodology for Tidal Wetland and Seagrass Restoration, v2.1_.
- **MoES / NCCR Protocol:** _National Centre for Coastal Research Blue Carbon MRV Standards (2026)_.

> [!IMPORTANT]
> **Methodological Status Notice: Pre-Review Scientific Prototype**
> This specification defines the computational equations and reference parameters implemented in the BlueCarbon Registry engine.
> Citations of IPCC (2013), Verra VM0033, and peer-reviewed literature represent computational design baselines. They **do not** constitute independent third-party validation, regulatory accreditation, or commercial approval.
> Real-world commercial crediting requires formal project validation and on-site audit by an accredited Validation and Verification Body (VVB) to establish site-specific parameter applicability for newly restored coastal sites.

---

## 1. Accounting Scope & Boundaries

### 1.1 Spatial & Geographic Boundaries

- Eligible ecosystems: Tropical and subtropical mangroves, seagrass meadows, tidal salt marshes, and coastal brackish wetlands.
- Geographic focus: Coastal states and union territories of India (e.g., Sundarbans, Gulf of Kutch, Pichavaram, Chilika Lake, Andaman & Nicobar).
- Project area boundary must be mapped via valid polygon coordinates (minimum 3 coordinates, area > 0.1 hectares).

### 1.2 Carbon Pools

| Pool                          | Included    | Methodological Justification                                                         |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| **Aboveground Biomass (AGB)** | ✅ Yes      | Tree trunk, branches, foliage. Measured via allometric growth models.                |
| **Belowground Biomass (BGB)** | ✅ Yes      | Root biomass; calculated using ecosystem-specific root-to-shoot ratios.              |
| **Soil Organic Carbon (SOC)** | ✅ Yes      | Autochthonous sediment accretion in top 100 cm mineral soils.                        |
| **Dead Wood & Litter**        | ❌ Excluded | Excluded conservatively to prevent double counting and high measurement uncertainty. |

---

## 2. Sequestration Coefficients & Literature Citations

| Ecosystem            | Biomass Rate ($t\text{CO}_2\text{e}/\text{ha}/\text{yr}$) | Soil Accretion Rate ($t\text{CO}_2\text{e}/\text{ha}/\text{yr}$) | Gross Rate ($t\text{CO}_2\text{e}/\text{ha}/\text{yr}$) | Primary Reference                                         |
| -------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| **Mangrove Forest**  | $7.80$                                                    | $5.90$                                                           | $13.70$                                                 | IPCC (2013) Wetlands Supp. Ch 4, Table 4.4 & Table 4.11   |
| **Seagrass Meadow**  | $0.40$                                                    | $4.80$                                                           | $5.20$                                                  | Fourqurean et al. (2012, _Nature Geosci._ 5:505–509)      |
| **Tidal Salt Marsh** | $2.10$                                                    | $6.20$                                                           | $8.30$                                                  | Chmura et al. (2003, _Global Biogeochem. Cycles_ 17:1111) |
| **Coastal Wetland**  | $3.20$                                                    | $4.50$                                                           | $7.70$                                                  | Verra VM0033 Table 2 & IPCC Ch 4 Default Parameters       |

---

## 3. Mathematical Formulae

### 3.1 Net Carbon Impact Equation

$$C_{\text{net}} = \Big[ (C_{\text{gross}} - D_{\text{CH}_4} - D_{\text{leakage}}) \times (1 - B_{\text{reversal}}) \times (1 - U_{\text{discount}}) \Big]$$

Where:

1. **$C_{\text{gross}}$**: Gross annual accumulation:
   $$C_{\text{gross}} = A \times T \times \Big( (R_{\text{bio}} \times S_{\text{rate}}) + R_{\text{soil}} \Big)$$
   - $A$: Project area in hectares
   - $T$: Duration in years between restoration start and monitoring date
   - $R_{\text{bio}}$: Biomass sequestration coefficient
   - $S_{\text{rate}}$: Sapling survival rate fraction ($0.0 \dots 1.0$)
   - $R_{\text{soil}}$: Soil carbon accretion coefficient

2. **$D_{\text{CH}_4}$ (Methane Emission Deduction)**:
   - For waters where salinity $\ge 18\text{ ppt}$, sulfate reduction suppresses methanogenesis ($D_{\text{CH}_4} = 0$).
   - For waters where salinity $< 18\text{ ppt}$, apply IPCC (2013) Wetlands Supplement Table 4.14 default methane deduction:
     $$D_{\text{CH}_4} = A \times T \times 5.42\text{ tCO}_2\text{e}/\text{ha}/\text{yr}$$
     Based on IPCC default emission factor $193.7\text{ kg CH}_4/\text{ha}/\text{yr}$ with GWP-100 of 28 ($193.7 \times 28 / 1000 \approx 5.42\text{ tCO}_2\text{e}/\text{ha}/\text{yr}$).

3. **$B_{\text{reversal}}$ (Non-Permanence Risk Buffer)**:
   - Mandatory withholding of **15.0%** (Verra AFOLU Risk Tool guideline) allocated to an uncredited reversal risk buffer pool (hedging against cyclones, sea-level rise, die-offs).

4. **$U_{\text{discount}}$ (Scientific Uncertainty Deduction)**:
   - **Tier 1 (Literature Default):** 10.0% deduction (conservative baseline for default regional parameters).
   - **Tier 2 (Ground-Truthed Site Sampling):** 5.0% deduction when site-calibrated ground truth sampling or allometric growth survey evidence is verified.
   - **Tier 3 (Continuous Soil Cores & Allometry):** 3.0% deduction when both validated laboratory soil core organic carbon assays (e.g. Loss-on-Ignition / Walkley-Black) and allometric permanent sample plots are verified.

### 3.2 Decoupling of Biomass and Soil Accretion

The gross carbon formula decouples vegetative biomass accumulation from soil mineral carbon accretion:
$$C_{\text{gross}} = A \times T \times \Big( (R_{\text{bio}} \times S_{\text{rate}}) + R_{\text{soil}} \Big)$$

- **Biomass Carbon ($R_{\text{bio}} \times S_{\text{rate}}$):** Directly dependent on sapling establishment, vegetative density, and tree survival ($S_{\text{rate}}$).
- **Soil Accretion ($R_{\text{soil}}$):** Represents mineral sediment deposition and autochthonous/allochthonous organic matter trapping in coastal wetlands. In hydrodynamically restored intertidal zones, tidal inundation deposits carbon-bearing sediment across the wetland basin even when vegetative canopy cover is establishing. In `STRICT_VERIFICATION` mode, Tier 3 soil accretion requires empirical site-specific sediment core assays.

### 3.3 Output Nomenclature & Semantics

- **`grossMinusEmissionsAndLeakageTco2e` (aliased as `netEstimatedTco2e`):** Intermediate subtotal reflecting gross sequestration minus methane emissions and leakage, before applying non-permanence risk buffers and uncertainty discounts.
- **`netModelEstimateTco2e` (aliased as `netVerifiedTco2e`):** The final conservative model-calculated carbon metric after deducting the 15% risk buffer and tier-specific uncertainty discount ($3\%\dots 10\%$).
- **Distinction from Carbon Credits:** Neither field represents an issued financial carbon credit. Credits may only be minted after independent VVB verification and formal registry authorization.

---

## 4. Empirical Validation & Benchmark Tests

The repository maintains two distinct testing regimens:

### 4.1 Independent Empirical Validation

The model is validated against published, held-out field observations from peer-reviewed Indian coastal wetland studies (see `src/lib/empirical-validation-data.ts`):

1. **Sundarbans Biosphere Reserve** (Ray et al. 2011): Avicennia/Rhizophora mangrove soil accretion & biomass.
2. **Pichavaram Mangrove Wetland** (Kathiresan 2000): Long-term restored Rhizophora stand observations.
3. **Chilika Lagoon** (Ganguly et al. 2017): Seagrass meadow (Halophila ovalis) carbon accumulation.

The empirical validation suite checks:

- Model predictions fall within the reported 95% confidence intervals of measured field datasets.
- Mean Absolute Percentage Error (MAPE) remains $< 20\%$ across independent coastal sites.

### 4.2 Computational Regression Benchmarks

Internal benchmark ranges in `REFERENCE_BENCHMARKS` serve strictly as calculation consistency and regression guards to prevent accidental formula alterations across software releases:

| Benchmark Site           | Ecosystem | Area (ha) | Expected Range (tCO₂e/yr) | Measured Model Output |
| ------------------------ | --------- | --------- | ------------------------- | --------------------- |
| **Sundarbans Biosphere** | Mangrove  | 100.0     | $900 \dots 1,600$         | $1,190.2$ tCO₂e       |
| **Pichavaram Mangroves** | Mangrove  | 25.0      | $200 \dots 450$           | $297.5$ tCO₂e         |
| **Chilika Lagoon**       | Seagrass  | 50.0      | $150 \dots 350$           | $234.0$ tCO₂e         |

---

## 5. Regulatory Disclaimer

> **Important:** Verified carbon impact calculated by this system serves as an auditable scientific MRV metric for administrative compliance and demonstration. It does **not** constitute registered financial carbon offsets or tradable carbon credits under VCS, Gold Standard, or Article 6 without accredited Independent Third-Party Validation and Verification Body (VVB) audit.
