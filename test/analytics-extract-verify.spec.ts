import { describe, expect, it } from "vitest";
import { ExportManifest } from "../src/analytics-extract";
import {
  ANALYTICS_IMPORT_PREFIXES,
  parseExportManifest,
  validateManifestTieBack,
} from "../src/analytics-extract-verify";

const sampleManifest: ExportManifest = {
  manifest_version: 2,
  extraction_timestamp: "2026-08-15T03:05:00.000Z",
  tables: {
    checkin_prompt: {
      row_count: 2,
      source_row_count: 2,
      object_key:
        "raw/cloudflare/checkins/checkin_prompt/extraction_date=2026-08-15/030000.jsonl.gz",
    },
    checkin_response: {
      row_count: 1,
      source_row_count: 1,
      object_key:
        "raw/cloudflare/checkins/checkin_response/extraction_date=2026-08-15/030000.jsonl.gz",
    },
  },
};

describe("validateManifestTieBack", () => {
  it("passes when manifest counts match jsonl line counts", () => {
    const result = validateManifestTieBack(sampleManifest, 2, 1);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports mismatches per table", () => {
    const result = validateManifestTieBack(sampleManifest, 1, 0);
    expect(result.ok).toBe(false);
    // Each table disagrees with both the manifest row_count and the source count.
    expect(result.errors).toHaveLength(4);
    expect(result.withoutSourceCount).toHaveLength(0);
  });

  it("catches a source count that disagrees with the landed rows", () => {
    // The short-read shape: the worker fetched and wrote 2 rows, but D1 held 3.
    // manifest row_count and the JSONL agree, so only the source count sees it.
    const shortRead: ExportManifest = {
      ...sampleManifest,
      tables: {
        ...sampleManifest.tables,
        checkin_prompt: {
          ...sampleManifest.tables.checkin_prompt,
          source_row_count: 3,
        },
      },
    };
    const result = validateManifestTieBack(shortRead, 2, 1);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((error) => error.includes("source_row_count 3")),
    ).toBe(true);
  });

  it("flags manifest_version 1 artifacts as lacking a source count", () => {
    const legacy: ExportManifest = {
      extraction_timestamp: sampleManifest.extraction_timestamp,
      tables: {
        checkin_prompt: {
          row_count: 2,
          object_key: sampleManifest.tables.checkin_prompt.object_key,
        },
        checkin_response: {
          row_count: 1,
          object_key: sampleManifest.tables.checkin_response.object_key,
        },
      },
    };
    const result = validateManifestTieBack(legacy, 2, 1);
    // Still passes the manifest-to-jsonl check, but says what it cannot prove.
    expect(result.ok).toBe(true);
    expect(result.withoutSourceCount).toEqual(["checkin_prompt", "checkin_response"]);
  });

  it("rejects a version 2 manifest that omits a source count", () => {
    // Declaring version 2 promises the tie-back. Accepting a missing field here
    // would silently drop back to the tautological manifest-to-JSONL check.
    const broken: ExportManifest = {
      manifest_version: 2,
      extraction_timestamp: sampleManifest.extraction_timestamp,
      tables: {
        checkin_prompt: {
          row_count: 2,
          object_key: sampleManifest.tables.checkin_prompt.object_key,
        },
        checkin_response: sampleManifest.tables.checkin_response,
      },
    };
    const result = validateManifestTieBack(broken, 2, 1);
    expect(result.ok).toBe(false);
    expect(result.withoutSourceCount).toHaveLength(0);
    expect(
      result.errors.some((error) =>
        error.includes("declares manifest_version 2 but has no source_row_count"),
      ),
    ).toBe(true);
  });

  it("rejects malformed manifest_version values", () => {
    // parseExportManifest casts arbitrary JSON, so these all reach the
    // validator at runtime. Treating any of them as legacy would verify a
    // malformed artifact on the manifest-to-JSONL check alone.
    for (const version of [0, -1, 1.5, "abc", null]) {
      const broken = {
        manifest_version: version,
        extraction_timestamp: sampleManifest.extraction_timestamp,
        tables: {
          checkin_prompt: {
            row_count: 2,
            object_key: sampleManifest.tables.checkin_prompt.object_key,
          },
          checkin_response: {
            row_count: 1,
            object_key: sampleManifest.tables.checkin_response.object_key,
          },
        },
      } as unknown as ExportManifest;
      const result = validateManifestTieBack(broken, 2, 1);
      expect(result.ok).toBe(false);
      expect(result.withoutSourceCount).toHaveLength(0);
      expect(
        result.errors.some((error) => error.includes("unsupported manifest_version")),
      ).toBe(true);
    }
  });

  it("accepts a future version that still carries the source count", () => {
    const future: ExportManifest = { ...sampleManifest, manifest_version: 3 };
    expect(validateManifestTieBack(future, 2, 1).ok).toBe(true);
  });

  it("rejects unexpected object key prefixes", () => {
    const badManifest: ExportManifest = {
      ...sampleManifest,
      tables: {
        ...sampleManifest.tables,
        checkin_prompt: {
          row_count: 2,
          source_row_count: 2,
          object_key: "wrong/prefix/file.jsonl.gz",
        },
      },
    };
    const result = validateManifestTieBack(badManifest, 2, 1);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("unexpected prefix"))).toBe(true);
  });
});

describe("parseExportManifest", () => {
  it("parses manifest JSON written by the extract", () => {
    const parsed = parseExportManifest(JSON.stringify(sampleManifest));
    expect(parsed.tables.checkin_response.row_count).toBe(1);
  });
});

describe("analytics import prefixes", () => {
  it("maps one S3 import source per exported table", () => {
    expect(ANALYTICS_IMPORT_PREFIXES.checkin_prompt).toMatch(/checkin_prompt\/$/);
    expect(ANALYTICS_IMPORT_PREFIXES.checkin_response).toMatch(/checkin_response\/$/);
    expect(ANALYTICS_IMPORT_PREFIXES.manifests).toMatch(/manifests\/$/);
  });
});
