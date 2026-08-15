import { log } from "./logger";
import {
  ExportedPromptRow,
  ExportedResponseRow,
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

export interface ExportManifest {
  extraction_timestamp: string;
  tables: {
    checkin_prompt: { row_count: number; object_key: string };
    checkin_response: { row_count: number; object_key: string };
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

export function buildManifest(
  slot: ExportSlot,
  extractionTimestamp: string,
  promptKey: string,
  promptCount: number,
  responseKey: string,
  responseCount: number,
): ExportManifest {
  return {
    extraction_timestamp: extractionTimestamp,
    tables: {
      checkin_prompt: { row_count: promptCount, object_key: promptKey },
      checkin_response: { row_count: responseCount, object_key: responseKey },
    },
  };
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
    promptKey,
    prompts.length,
    responseKey,
    responses.length,
  );

  await env.EXTRACT_BUCKET.put(manifestKey, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });

  log("info", "analytics_extract_completed", {
    extraction_date: slot.extractionDate,
    prompt_count: prompts.length,
    response_count: responses.length,
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
