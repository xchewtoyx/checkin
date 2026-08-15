import { ExportManifest } from "./analytics-extract";

export interface ManifestTieBackResult {
  ok: boolean;
  errors: string[];
}

export function validateManifestTieBack(
  manifest: ExportManifest,
  promptLineCount: number,
  responseLineCount: number,
): ManifestTieBackResult {
  const errors: string[] = [];

  if (manifest.tables.checkin_prompt.row_count !== promptLineCount) {
    errors.push(
      `checkin_prompt manifest row_count ${manifest.tables.checkin_prompt.row_count} != jsonl lines ${promptLineCount}`,
    );
  }

  if (manifest.tables.checkin_response.row_count !== responseLineCount) {
    errors.push(
      `checkin_response manifest row_count ${manifest.tables.checkin_response.row_count} != jsonl lines ${responseLineCount}`,
    );
  }

  if (!manifest.tables.checkin_prompt.object_key.startsWith("raw/cloudflare/checkins/checkin_prompt/")) {
    errors.push("checkin_prompt object_key has unexpected prefix");
  }

  if (!manifest.tables.checkin_response.object_key.startsWith("raw/cloudflare/checkins/checkin_response/")) {
    errors.push("checkin_response object_key has unexpected prefix");
  }

  return { ok: errors.length === 0, errors };
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
