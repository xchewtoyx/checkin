import { log } from "./logger";
import {
  ExportedPromptRow,
  ExportedResponseRow,
  countAllPromptsForExport,
  countAllResponsesForExport,
  listAllPromptsForExport,
  listAllResponsesForExport,
} from "./store";

/** Daily export slots in UTC — two runs per calendar day, 12 hours apart (D4). */
export const EXPORT_SLOTS_UTC = [
  { hour: 3, minute: 0 },
  { hour: 15, minute: 0 },
] as const;

/** Cron interval — export window matches the scheduled handler cadence. */
export const EXPORT_SLOT_WINDOW_MINUTES = 15;

export interface AnalyticsExtractEnv {
  DB: D1Database;
  EXTRACT_BUCKET?: R2Bucket;
}

/**
 * Manifest schema version. 1 (implicit, absent field) is every manifest written
 * before the independent source-count check; 2 adds `source_row_count`.
 */
export const EXPORT_MANIFEST_VERSION = 2;

export interface ExportTableManifest {
  /** Rows serialized into the JSONL object. */
  row_count: number;
  /**
   * Rows reported by a separate `SELECT COUNT(*)` against the source table —
   * a different code path from the row fetch, so it can catch a short read the
   * manifest/JSONL comparison cannot. Absent in manifest_version 1 artifacts.
   */
  source_row_count?: number;
  object_key: string;
}

export interface ExportManifest {
  /** Absent in manifest_version 1 artifacts written before the source count. */
  manifest_version?: number;
  extraction_timestamp: string;
  tables: {
    checkin_prompt: ExportTableManifest;
    checkin_response: ExportTableManifest;
  };
}

export interface ExportSlot {
  scheduledAt: Date;
  extractionDate: string;
  objectTimestamp: string;
}

export function formatExtractionDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatObjectTimestamp(date: Date): string {
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${hours}${minutes}${seconds}`;
}

export function buildExportSlot(
  calendarDay: Date,
  hour: number,
  minute: number,
): ExportSlot {
  const scheduledAt = new Date(
    Date.UTC(
      calendarDay.getUTCFullYear(),
      calendarDay.getUTCMonth(),
      calendarDay.getUTCDate(),
      hour,
      minute,
      0,
      0,
    ),
  );
  return {
    scheduledAt,
    extractionDate: formatExtractionDate(scheduledAt),
    objectTimestamp: formatObjectTimestamp(scheduledAt),
  };
}

export function getExportSlotsForDay(now: Date): ExportSlot[] {
  return EXPORT_SLOTS_UTC.map(({ hour, minute }) => buildExportSlot(now, hour, minute));
}

export function shouldRunExport(now: Date): ExportSlot | null {
  for (const slot of getExportSlotsForDay(now)) {
    const windowEnd = new Date(
      slot.scheduledAt.getTime() + EXPORT_SLOT_WINDOW_MINUTES * 60 * 1000,
    );
    if (now >= slot.scheduledAt && now < windowEnd) {
      return slot;
    }
  }
  return null;
}

export function buildTableObjectKey(
  table: "checkin_prompt" | "checkin_response",
  slot: ExportSlot,
): string {
  return `raw/cloudflare/checkins/${table}/extraction_date=${slot.extractionDate}/${slot.objectTimestamp}.jsonl.gz`;
}

export function buildManifestObjectKey(slot: ExportSlot): string {
  return `raw/cloudflare/checkins/manifests/extraction_date=${slot.extractionDate}/${slot.objectTimestamp}.json`;
}

export function serializeJsonl(rows: object[]): string {
  if (rows.length === 0) {
    return "";
  }
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

export async function gzipText(text: string): Promise<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text);
  const stream = new Blob([encoded])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function gunzipText(data: ArrayBuffer): Promise<string> {
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export async function countJsonlLines(data: ArrayBuffer): Promise<number> {
  const text = await gunzipText(data);
  if (text.length === 0) {
    return 0;
  }
  return text.trimEnd().split("\n").length;
}

export interface ExportTableCounts {
  objectKey: string;
  rowCount: number;
  sourceRowCount: number;
}

export function buildManifest(
  slot: ExportSlot,
  extractionTimestamp: string,
  prompt: ExportTableCounts,
  response: ExportTableCounts,
): ExportManifest {
  return {
    manifest_version: EXPORT_MANIFEST_VERSION,
    extraction_timestamp: extractionTimestamp,
    tables: {
      checkin_prompt: {
        row_count: prompt.rowCount,
        source_row_count: prompt.sourceRowCount,
        object_key: prompt.objectKey,
      },
      checkin_response: {
        row_count: response.rowCount,
        source_row_count: response.sourceRowCount,
        object_key: response.objectKey,
      },
    },
  };
}

export interface SourceCountCheck {
  table: "checkin_prompt" | "checkin_response";
  /** Rows the export query returned. */
  fetched: number;
  /** Rows the independent SELECT COUNT(*) reported. */
  source: number;
}

/**
 * Fail closed on a source-count disagreement: throw before anything is written,
 * so a short read never lands as a complete-looking slot. The cost is that a
 * transient skew between the fetch and the count loses the slot, which then
 * shows up as a gap for landing-zone completeness checks to catch.
 */
export function assertSourceCountsAgree(
  slot: ExportSlot,
  checks: SourceCountCheck[],
): void {
  const mismatched = checks.filter((check) => check.fetched !== check.source);
  if (mismatched.length === 0) {
    return;
  }

  const detail = mismatched
    .map((check) => `${check.table} fetched=${check.fetched} source=${check.source}`)
    .join("; ");

  log("error", "analytics_extract_source_count_mismatch", {
    extraction_date: slot.extractionDate,
    detail,
  });

  throw new Error(`analytics_extract_source_count_mismatch: ${detail}`);
}

export async function executeAnalyticsExtract(
  env: AnalyticsExtractEnv,
  slot: ExportSlot,
  now: Date,
): Promise<ExportManifest> {
  if (!env.EXTRACT_BUCKET) {
    throw new Error("extract_bucket_unconfigured");
  }

  const prompts = await listAllPromptsForExport(env.DB);
  const responses = await listAllResponsesForExport(env.DB);

  // Independent source counts: a separate SELECT COUNT(*) rather than
  // prompts.length, so a short read from the unpaged export query is visible.
  // Comparing the manifest against the JSONL alone cannot see it — both sides
  // derive from the same in-memory array.
  const promptSourceCount = await countAllPromptsForExport(env.DB);
  const responseSourceCount = await countAllResponsesForExport(env.DB);

  assertSourceCountsAgree(slot, [
    { table: "checkin_prompt", fetched: prompts.length, source: promptSourceCount },
    { table: "checkin_response", fetched: responses.length, source: responseSourceCount },
  ]);

  const promptKey = buildTableObjectKey("checkin_prompt", slot);
  const responseKey = buildTableObjectKey("checkin_response", slot);
  const manifestKey = buildManifestObjectKey(slot);
  const extractionTimestamp = now.toISOString();

  const promptBody = await gzipText(serializeJsonl(prompts));
  const responseBody = await gzipText(serializeJsonl(responses));

  await env.EXTRACT_BUCKET.put(promptKey, promptBody, {
    httpMetadata: { contentType: "application/gzip" },
  });
  await env.EXTRACT_BUCKET.put(responseKey, responseBody, {
    httpMetadata: { contentType: "application/gzip" },
  });

  const manifest = buildManifest(
    slot,
    extractionTimestamp,
    { objectKey: promptKey, rowCount: prompts.length, sourceRowCount: promptSourceCount },
    {
      objectKey: responseKey,
      rowCount: responses.length,
      sourceRowCount: responseSourceCount,
    },
  );

  await env.EXTRACT_BUCKET.put(manifestKey, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });

  log("info", "analytics_extract_completed", {
    extraction_date: slot.extractionDate,
    prompt_count: prompts.length,
    response_count: responses.length,
    prompt_source_count: promptSourceCount,
    response_source_count: responseSourceCount,
    manifest_key: manifestKey,
  });

  return manifest;
}

export async function runAnalyticsExtract(
  env: AnalyticsExtractEnv,
  now: Date,
): Promise<{ skipped: true; reason: string } | { skipped: false; manifest: ExportManifest }> {
  if (!env.EXTRACT_BUCKET) {
    return { skipped: true, reason: "extract_bucket_unconfigured" };
  }

  const slot = shouldRunExport(now);
  if (!slot) {
    return { skipped: true, reason: "outside_export_window" };
  }

  const manifest = await executeAnalyticsExtract(env, slot, now);
  return { skipped: false, manifest };
}
