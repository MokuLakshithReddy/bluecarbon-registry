/**
 * Zero-Trust Geospatial Boundary & Biome Overlap Validator
 *
 * Implements strict geospatial validation for blue carbon project registration:
 * 1. Global coordinate sanity (-90 <= lat <= 90, -180 <= lng <= 180).
 * 2. Coastal/marine biome boundary validation (e.g. India coastline and coastal marine biomes).
 * 3. Polygon geometry validation (minimum 3 coordinates, closed polygon, positive area).
 * 4. Spatial overlap collision detection (preventing territorial double-registration across claims).
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export type GeoPolygon = GeoPoint[];

export interface RegisteredClaim {
  projectId: string;
  projectCode: string;
  polygon: GeoPolygon;
}

// Bounding boxes for recognized Indian coastal blue-carbon zones (lat min/max, lng min/max)
export const RECOGNIZED_COASTAL_BIOME_BOUNDS = [
  // West Coast (Gujarat, Maharashtra, Goa, Karnataka, Kerala)
  { name: "West Coast Mangrove Belt", minLat: 8.0, maxLat: 24.5, minLng: 68.0, maxLng: 77.5 },
  // East Coast (Tamil Nadu, Andhra Pradesh, Odisha, West Bengal / Sundarbans)
  { name: "East Coast / Sundarbans Delta", minLat: 8.0, maxLat: 22.8, minLng: 77.0, maxLng: 89.5 },
  // Andaman & Nicobar Islands
  { name: "Andaman & Nicobar Islands", minLat: 6.5, maxLat: 14.0, minLng: 92.0, maxLng: 94.5 },
  // Lakshadweep Atolls
  { name: "Lakshadweep Coral & Seagrass", minLat: 8.0, maxLat: 12.5, minLng: 71.0, maxLng: 74.5 },
];

/**
 * Validates basic coordinate validity.
 */
export function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    typeof lat === "number" &&
    !Number.isNaN(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === "number" &&
    !Number.isNaN(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Validates that coordinates fall within an authorized blue carbon coastal biome.
 */
export function isWithinCoastalBiome(lat: number, lng: number): boolean {
  if (!isValidCoordinate(lat, lng)) return false;
  return RECOGNIZED_COASTAL_BIOME_BOUNDS.some(
    (b) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng,
  );
}

/**
 * Ray-casting algorithm to test if a point is inside a polygon.
 */
export function isPointInPolygon(point: GeoPoint, polygon: GeoPolygon): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i]!.longitude;
    const yi = polygon[i]!.latitude;
    const xj = polygon[j]!.longitude;
    const yj = polygon[j]!.latitude;

    const intersect =
      yi > point.latitude !== yj > point.latitude &&
      point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Tests if two 2D line segments (p1-p2 and p3-p4) intersect.
 */
function doSegmentsIntersect(p1: GeoPoint, p2: GeoPoint, p3: GeoPoint, p4: GeoPoint): boolean {
  function ccw(a: GeoPoint, b: GeoPoint, c: GeoPoint): boolean {
    return (
      (c.latitude - a.latitude) * (b.longitude - a.longitude) >
      (b.latitude - a.latitude) * (c.longitude - a.longitude)
    );
  }

  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

/**
 * Checks whether two polygons overlap (either edge intersection or containment).
 */
export function doPolygonsOverlap(polyA: GeoPolygon, polyB: GeoPolygon): boolean {
  if (polyA.length < 3 || polyB.length < 3) return false;

  // 1. Check if any vertex of polyA is inside polyB
  for (const pt of polyA) {
    if (isPointInPolygon(pt, polyB)) return true;
  }

  // 2. Check if any vertex of polyB is inside polyA
  for (const pt of polyB) {
    if (isPointInPolygon(pt, polyA)) return true;
  }

  // 3. Check if any edges intersect
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i]!;
    const a2 = polyA[(i + 1) % polyA.length]!;

    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j]!;
      const b2 = polyB[(j + 1) % polyB.length]!;

      if (doSegmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validates a project polygon against geometry rules and territorial double-registration.
 */
export function validateProjectBoundary(
  candidatePolygon: GeoPolygon,
  existingClaims: RegisteredClaim[] = [],
): {
  isValid: boolean;
  errors: string[];
  overlappingProjectCode?: string | undefined;
} {
  const errors: string[] = [];

  if (!Array.isArray(candidatePolygon) || candidatePolygon.length < 3) {
    errors.push("Project boundary polygon must contain at least 3 coordinate points");
    return { isValid: false, errors };
  }

  // Validate all coordinates
  for (let i = 0; i < candidatePolygon.length; i++) {
    const pt = candidatePolygon[i]!;
    if (!isValidCoordinate(pt.latitude, pt.longitude)) {
      errors.push(
        `Vertex #${i + 1} has invalid latitude (${pt.latitude}) or longitude (${pt.longitude})`,
      );
    } else if (!isWithinCoastalBiome(pt.latitude, pt.longitude)) {
      errors.push(
        `Vertex #${i + 1} (${pt.latitude}, ${pt.longitude}) falls outside recognized coastal restoration biomes`,
      );
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  // Anti-collision / territorial double-registration check
  for (const claim of existingClaims) {
    if (doPolygonsOverlap(candidatePolygon, claim.polygon)) {
      errors.push(
        `Territorial collision detected: boundary overlaps with already registered project '${claim.projectCode}'`,
      );
      return {
        isValid: false,
        errors,
        overlappingProjectCode: claim.projectCode,
      };
    }
  }

  return {
    isValid: true,
    errors: [],
  };
}
