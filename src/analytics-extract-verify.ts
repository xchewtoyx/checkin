import { ExportManifest, ExportTableManifest } from "./analytics-extract";

export interface ManifestTieBackResult {
  ok: boolean;
  errors: string[];
  /**
   * Tables whose manifest carries no `source_row_count` (manifest_version 1).
   * For those the check is manifest-to-JSONL only, which cannot detect a short
   * read from the export query.
   */
  withoutSourceCount: string[];
}

function checkTable(
  table: string,
  entry: ExportTableManifest,
  lineCount: number,
  manifestVersion: number,
  errors: string[],
  withoutSourceCount: string[],
): void {
  if (entry.row_count !== lineCount) {
    errors.push(
      `${table} manifest row_count ${entry.row_count} != jsonl lines ${lineCount}`,
    );
  }

  if (entry.source_row_count === undefined) {
    // Only a version 1 manifest may lack the source count. Declaring version 2
    // is the promise that the tie-back is present, so a missing field there is
    // a broken artifact rather than a legacy one — accepting it would silently
    // drop the check back to the tautological manifest-to-JSONL comparison.
    if (manifestVersion >= 2) {
      errors.push(
        `${table} manifest declares manifest_version ${manifestVersion} but has no source_row_count`,
      );
      return;
    }
    withoutSourceCount.push(table);
    return;
  }

  if (entry.source_row_count !== entry.row_count) {
    errors.push(
      `${table} manifest source_row_count ${entry.source_row_count} != row_count ${entry.row_count}`,
    );
  }

  if (entry.source_row_count !== lineCount) {
    errors.push(
      `${table} manifest source_row_count ${entry.source_row_count} != jsonl lines ${lineCount}`,
    );
  }
}

export function validateManifestTieBack(
  manifest: ExportManifest,
  promptLineCount: number,
  responseLineCount: number,
): ManifestTieBackResult {
  const errors: string[] = [];
  const withoutSourceCount: string[] = [];
  const manifestVersion = manifest.manifest_version ?? 1;

  checkTable(
    "checkin_prompt",
    manifest.tables.checkin_prompt,
    promptLineCount,
    manifestVersion,
    errors,
    withoutSourceCount,
  );
  checkTable(
    "checkin_response",
    manifest.tables.checkin_response,
    responseLineCount,
    manifestVersion,
    errors,
    withoutSourceCount,
  );

  if (!manifest.tables.checkin_prompt.object_key.startsWith("raw/cloudflare/checkins/checkin_prompt/")) {
    errors.push("checkin_prompt object_key has unexpected prefix");
  }

  if (!manifest.tables.checkin_response.object_key.startsWith("raw/cloudflare/checkins/checkin_response/")) {
    errors.push("checkin_response object_key has unexpected prefix");
  }

  return { ok: errors.length === 0, errors, withoutSourceCount };
}

export function parseExportManifest(raw: string): ExportManifest {
  return JSON.parse(raw) as ExportManifest;
}

/** Expected import prefixes for the analytics platform S3 source. */
export const ANALYTICS_IMPORT_PREFIXES = {
  checkin_prompt: "raw/cloudflare/checkins/checkin_prompt/",
  checkin_response: "raw/cloudflare/checkins/checkin_response/",
  manifests: "raw/cloudflare/checkins/manifests/",
} as const;

/** R2 bucket name bound as EXTRACT_BUCKET in production. */
export const ANALYTICS_R2_BUCKET = "checkin-analytics";
