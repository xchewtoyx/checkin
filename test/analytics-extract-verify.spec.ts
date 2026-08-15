import { describe, expect, it } from "vitest";
import { ExportManifest } from "../src/analytics-extract";
import {
  ANALYTICS_IMPORT_PREFIXES,
  parseExportManifest,
  validateManifestTieBack,
} from "../src/analytics-extract-verify";

const sampleManifest: ExportManifest = {
  extraction_timestamp: "2026-08-15T03:05:00.000Z",
  tables: {
    checkin_prompt: {
      row_count: 2,
      object_key:
        "raw/cloudflare/checkins/checkin_prompt/extraction_date=2026-08-15/030000.jsonl.gz",
    },
    checkin_response: {
      row_count: 1,
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
    expect(result.errors).toHaveLength(2);
  });

  it("rejects unexpected object key prefixes", () => {
    const badManifest: ExportManifest = {
      ...sampleManifest,
      tables: {
        ...sampleManifest.tables,
        checkin_prompt: {
          row_count: 2,
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
