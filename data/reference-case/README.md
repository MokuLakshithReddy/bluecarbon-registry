# Reference Case Data Fixtures

**Classification:** `SYNTHETIC_DEMONSTRATION_FIXTURE`  
**Purpose:** End-to-End MRV Pipeline Verification & Integration Testing  
**Grounding Literature:** Ray et al. (2011), _Atmospheric Environment_ 45(28): 5016–5024; IPCC (2013) Wetlands Supplement Ch 4

---

## 1. Data Authenticity & Scope Notice

The data files in this directory are **synthetic demonstration fixtures** designed to enable fully reproducible, byte-exact automated testing of the BlueCarbon Registry pipeline (evidence ingestion, cryptographic hashing, device signature verification, authoritative verifier decision binding, and EVM contract anchoring).

> [!WARNING]
> **Independent Authentication Notice:**
> The files in this directory do **NOT** establish that primary physical measurements were collected on-site by the named organizations:
>
> - The sediment core CSV is a synthetic depth profile modeled after published statistics, not an original ICAR-CIFRI laboratory analytical sheet.
> - The allometric census CSV is a synthetic plot census modeled after published survival rates, not an original field survey tally sheet.
> - The satellite JSON contains Level-2A summary metadata and vegetation index aggregates, not the primary underlying multispectral raster bands (GeoTIFFs) or certified ESA delivery packages.
> - The water quality telemetry JSON contains 20-day statistical summary aggregates signed with an enrolled device keypair, not the raw time-series array of 1,920 discrete 15-minute sensor transmissions.
>
> In a commercial or compliance blue-carbon registry, physical observation authenticity requires certified chain-of-custody documentation, calibrated hardware serial validation, and independent on-site audit by an accredited Validation and Verification Body (VVB).

---

## 2. File Inventory & Specifications

| File Name                                                                                              | Evidence Type                    | Grounding Parameters                               | Modeled Attributes                                                                       | Synthetic Nature                                                                          |
| :----------------------------------------------------------------------------------------------------- | :------------------------------- | :------------------------------------------------- | :--------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| [`lothian-sediment-cores-2024.csv`](./lothian-sediment-cores-2024.csv)                                 | `SOIL_CORE_ORGANIC_CARBON_ASSAY` | Ray et al. (2011) Table 4 & Section 3.3            | Mean SOC = $1.48\%$, Bulk density = $0.98\text{ g/cm}^3$, Depth = $0\dots 100\text{ cm}$ | Synthetic 12-segment depth profile demonstrating multi-depth SOC accretion calculation.   |
| [`lothian-allometric-census-2024.csv`](./lothian-allometric-census-2024.csv)                           | `ALLOMETRIC_GROWTH_SURVEY`       | Ray et al. (2011) Table 3 & Sunderbans Forest Dept | Survival rate = $85.0\%$ (17 alive / 3 dead), DBH = $6.2\dots 9.4\text{ cm}$             | Synthetic 20-tree sample census across 3 sample plots demonstrating survival weighting.   |
| [`lothian-sentinel2-surface-reflectance-2024.json`](./lothian-sentinel2-surface-reflectance-2024.json) | `MULTISPECTRAL_RASTER`           | ESA Copernicus Sentinel-2 Level-2A BOA             | Mean NDVI = $0.742 \pm 0.041$, Bounding Box = $100.0\text{ ha}$ geodesic                 | Synthetic product summary metadata and NDVI distribution; raw multi-band GeoTIFF omitted. |
| [`lothian-ysi-telemetry-2024.json`](./lothian-ysi-telemetry-2024.json)                                 | `CALIBRATED_SENSOR_TELEMETRY`    | YSI EXO2 Sonde / Saptamukhi Estuary                | Mean salinity = $24.5\text{ ppt}$ (min 21.2, max 28.6), Secp256k1 signed                 | Synthetic 20-day aggregation window demonstrating canonical payload ECDSA signing.        |
