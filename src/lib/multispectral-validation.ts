/**
 * Multispectral Index Validation & Carbon Sequestration Anomaly Detection
 *
 * Enforces strict scientific boundary schemas on optical/radar remote sensing data:
 * - NDVI (Normalized Difference Vegetation Index): [-1.0, 1.0]
 * - EVI (Enhanced Vegetation Index): [-1.0, 1.0]
 * - SAVI (Soil Adjusted Vegetation Index): [-1.0, 1.0]
 * - Canopy Cover (%): [0.0, 100.0]
 *
 * Detects physiological anomalies and unrealistic carbon sequestration spikes
 * to prevent fraudulent credit claims.
 */

import { z } from "zod";

export const MultispectralTelemetrySchema = z.object({
  ndvi: z.number().min(-1.0, "NDVI cannot be less than -1.0").max(1.0, "NDVI cannot exceed 1.0"),
  evi: z.number().min(-1.0, "EVI cannot be less than -1.0").max(1.0, "EVI cannot exceed 1.0"),
  savi: z
    .number()
    .min(-1.0, "SAVI cannot be less than -1.0")
    .max(1.0, "SAVI cannot exceed 1.0")
    .optional(),
  canopyCoverPercent: z
    .number()
    .min(0.0, "Canopy cover percentage must be >= 0%")
    .max(100.0, "Canopy cover percentage cannot exceed 100%"),
  cloudCoverFraction: z
    .number()
    .min(0.0)
    .max(1.0, "Cloud cover fraction must be between 0.0 and 1.0"),
  sensorBands: z.object({
    redReflectance: z.number().min(0.0).max(1.0),
    nirReflectance: z.number().min(0.0).max(1.0),
    blueReflectance: z.number().min(0.0).max(1.0).optional(),
    swirReflectance: z.number().min(0.0).max(1.0).optional(),
  }),
});

export type MultispectralTelemetry = z.infer<typeof MultispectralTelemetrySchema>;

// Maximum physiologically possible annual carbon sequestration rates (tCO2e / ha / year)
// based on IPCC Wetlands 2013 and peer-reviewed literature upper bounds
export const MAXIMUM_PHYSIOLOGICAL_SEQUESTRATION_LIMITS: Record<string, number> = {
  MANGROVE: 35.0, // High-density Rhizophora / Avicennia maximum under optimal tropical conditions
  SEAGRASS: 15.0, // Posidonia / Enhalus upper boundary
  SALT_MARSH: 20.0, // Spartina / Salicornia upper boundary
  COASTAL_WETLAND: 20.0,
  OTHER: 15.0,
};

export interface SequestrationSpikeCheckInput {
  ecosystem: string;
  claimedAnnualTco2ePerHectare: number;
  measuredNdvi: number;
}

/**
 * Checks for anomalous carbon sequestration claims that exceed natural biological limits
 * or contradict observed canopy spectral vegetation indices.
 */
export function checkSequestrationAnomaly(input: SequestrationSpikeCheckInput): {
  isAnomaly: boolean;
  reason?: string | undefined;
} {
  const maxLimit =
    MAXIMUM_PHYSIOLOGICAL_SEQUESTRATION_LIMITS[input.ecosystem] ??
    MAXIMUM_PHYSIOLOGICAL_SEQUESTRATION_LIMITS["OTHER"]!;

  // 1. Hard physiological ceiling
  if (input.claimedAnnualTco2ePerHectare > maxLimit) {
    return {
      isAnomaly: true,
      reason: `Claimed rate of ${input.claimedAnnualTco2ePerHectare} tCO2e/ha/yr exceeds the maximum physiological limit of ${maxLimit} tCO2e/ha/yr for ${input.ecosystem} biomes.`,
    };
  }

  // 2. Negative or zero sequestration check
  if (input.claimedAnnualTco2ePerHectare <= 0) {
    return {
      isAnomaly: true,
      reason: "Claimed sequestration rate must be strictly positive.",
    };
  }

  // 3. Spectral contradiction: high claimed carbon but degraded or non-vegetated NDVI
  // Water or bare sediment typically has NDVI < 0.2. High carbon claim with NDVI < 0.2 is anomalous.
  if (input.claimedAnnualTco2ePerHectare > 5.0 && input.measuredNdvi < 0.2) {
    return {
      isAnomaly: true,
      reason: `Spectral contradiction: Claimed high sequestration (${input.claimedAnnualTco2ePerHectare} tCO2e/ha/yr) but observed mean NDVI (${input.measuredNdvi}) indicates barren mudflats or open water.`,
    };
  }

  return { isAnomaly: false };
}
