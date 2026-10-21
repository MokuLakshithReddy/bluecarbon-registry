import test from "node:test";
import assert from "node:assert";
import {
  isValidCoordinate,
  isWithinCoastalBiome,
  isPointInPolygon,
  doPolygonsOverlap,
  validateProjectBoundary,
  type GeoPolygon,
  type RegisteredClaim,
} from "../../src/lib/geo-boundary-validator.ts";

test("Geo Boundary: Validates coordinates and recognized coastal biomes", () => {
  // Goa coastal coordinates (valid)
  assert.strictEqual(isValidCoordinate(15.5, 73.8), true);
  assert.strictEqual(isWithinCoastalBiome(15.5, 73.8), true);

  // Sundarbans coordinates (valid)
  assert.strictEqual(isValidCoordinate(21.8, 88.9), true);
  assert.strictEqual(isWithinCoastalBiome(21.8, 88.9), true);

  // Inland desert / non-coastal (invalid biome)
  assert.strictEqual(isValidCoordinate(27.0, 71.0), true); // Jaisalmer
  assert.strictEqual(isWithinCoastalBiome(27.0, 71.0), false);

  // Invalid coordinates
  assert.strictEqual(isValidCoordinate(95.0, 50.0), false);
  assert.strictEqual(isValidCoordinate(15.0, 200.0), false);
  assert.strictEqual(isValidCoordinate(NaN, 50.0), false);
});

test("Geo Boundary: Ray-casting detects point inside and outside polygon", () => {
  const squarePoly: GeoPolygon = [
    { latitude: 15.0, longitude: 73.0 },
    { latitude: 16.0, longitude: 73.0 },
    { latitude: 16.0, longitude: 74.0 },
    { latitude: 15.0, longitude: 74.0 },
  ];

  assert.strictEqual(isPointInPolygon({ latitude: 15.5, longitude: 73.5 }, squarePoly), true);
  assert.strictEqual(isPointInPolygon({ latitude: 17.0, longitude: 73.5 }, squarePoly), false);
  assert.strictEqual(isPointInPolygon({ latitude: 14.0, longitude: 73.5 }, squarePoly), false);
});

test("Geo Boundary: Collision detection prevents territorial double-registration", () => {
  // Existing registered project A in Sundarbans
  const projectA: RegisteredClaim = {
    projectId: "00000000-0000-0000-0000-000000000001",
    projectCode: "BC-MNG-SUNDAR-01",
    polygon: [
      { latitude: 21.8, longitude: 88.8 },
      { latitude: 21.9, longitude: 88.8 },
      { latitude: 21.9, longitude: 88.9 },
      { latitude: 21.8, longitude: 88.9 },
    ],
  };

  // Overlapping candidate project (collides with Project A)
  const overlappingCandidate: GeoPolygon = [
    { latitude: 21.85, longitude: 88.85 },
    { latitude: 21.95, longitude: 88.85 },
    { latitude: 21.95, longitude: 88.95 },
    { latitude: 21.85, longitude: 88.95 },
  ];

  const overlapCheck = validateProjectBoundary(overlappingCandidate, [projectA]);
  assert.strictEqual(overlapCheck.isValid, false);
  assert.strictEqual(overlapCheck.overlappingProjectCode, "BC-MNG-SUNDAR-01");
  assert.ok(overlapCheck.errors[0]?.includes("Territorial collision detected"));

  // Disjoint candidate project (valid and separated)
  const disjointCandidate: GeoPolygon = [
    { latitude: 21.6, longitude: 88.6 },
    { latitude: 21.7, longitude: 88.6 },
    { latitude: 21.7, longitude: 88.7 },
    { latitude: 21.6, longitude: 88.7 },
  ];

  const validCheck = validateProjectBoundary(disjointCandidate, [projectA]);
  assert.strictEqual(validCheck.isValid, true);
  assert.strictEqual(validCheck.errors.length, 0);
});
