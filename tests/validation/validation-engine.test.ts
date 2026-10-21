import test from "node:test";
import assert from "node:assert";
import { runValidation, haversineKm } from "../../src/lib/validation-engine.ts";

test("Validation Engine: Haversine distance correctly calculates kilometers", () => {
  // Chennai to Pondicherry (~135 km)
  const dist = haversineKm(13.0827, 80.2707, 11.9416, 79.8083);
  assert.ok(dist >= 130 && dist <= 145);
});

test("Validation Engine: All valid data scores high Evidence Quality Score", () => {
  const result = runValidation(
    {
      name: "Sundarbans Coastal Bio-Shield",
      organization: "Bengal Mangrove Trust",
      ecosystem: "MANGROVE",
      state: "West Bengal",
      district: "South 24 Parganas",
      area_hectares: 50,
      restoration_method: "Hand planting with nursery saplings",
      latitude: 21.9,
      longitude: 88.8,
      restoration_start: "2024-01-01",
      restoration_end: "2026-01-01",
      plant_count: 50000,
      survival_rate: 85,
      estimated_carbon: 1200,
    },
    [
      {
        file_name: "drone_overview.jpg",
        file_hash: "hash_001",
        latitude: 21.905,
        longitude: 88.802,
        capture_date: "2024-06-01",
      },
      {
        file_name: "quadrat_sampling.jpg",
        file_hash: "hash_002",
        latitude: 21.898,
        longitude: 88.795,
        capture_date: "2024-06-01",
      },
      {
        file_name: "seedling_density.jpg",
        file_hash: "hash_003",
        latitude: 21.901,
        longitude: 88.803,
        capture_date: "2024-06-02",
      },
    ],
  );

  assert.ok(result.score >= 85, `Score ${result.score} should be >= 85`);
  const requiredCheck = result.checks.find((c) => c.key === "required");
  assert.strictEqual(requiredCheck?.state, "PASS");
  const gpsCheck = result.checks.find((c) => c.key === "gps");
  assert.strictEqual(gpsCheck?.state, "PASS");
  const dupeCheck = result.checks.find((c) => c.key === "duplicates");
  assert.strictEqual(dupeCheck?.state, "PASS");
});

test("Validation Engine: Detects duplicate evidence files", () => {
  const result = runValidation(
    {
      name: "Test Project",
      organization: "Test Org",
      ecosystem: "MANGROVE",
      state: "Gujarat",
      district: "Kutch",
      area_hectares: 10,
      restoration_method: "Direct seeding",
      latitude: 23.1,
      longitude: 69.5,
    },
    [
      {
        file_name: "site_photo.jpg",
        file_hash: "identical_hash",
        latitude: 23.1,
        longitude: 69.5,
        capture_date: "2024-01-01",
      },
      {
        file_name: "site_photo_copy.jpg",
        file_hash: "identical_hash", // DUPLICATE HASH
        latitude: 23.1,
        longitude: 69.5,
        capture_date: "2024-01-01",
      },
    ],
  );

  const dupeCheck = result.checks.find((c) => c.key === "duplicates");
  assert.strictEqual(dupeCheck?.state, "WARN");
  assert.ok(dupeCheck?.detail.includes("duplicate"));
});

test("Validation Engine: Flags inverted restoration dates", () => {
  const result = runValidation({
    name: "Bad Dates Project",
    restoration_start: "2026-01-01",
    restoration_end: "2024-01-01", // END BEFORE START
  });

  const dateCheck = result.checks.find((c) => c.key === "dates");
  assert.strictEqual(dateCheck?.state, "FAIL");
  assert.ok(dateCheck?.detail.includes("not after"));
});
