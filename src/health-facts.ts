import {
  ExportSlot,
  buildManifestObjectKey,
} from "./analytics-extract";
import {
  DeliveredPrompt,
  DeliveredStatus,
  ExtractFacts,
  FRESHNESS_LOOKBACK_DAYS,
  HealthFacts,
  ManifestHead,
  parsePromptDateKey,
  recentExportSlots,
} from "./health-strip";
import { log } from "./logger";

export interface HealthFactsEnv {
  DB: D1Database;
  EXTRACT_BUCKET?: R2Bucket;
}

const DELIVERED: ReadonlySet<string> = new Set(["sent", "answered", "expired"]);

interface PromptScanRow {
  id: string;
  status: string;
  sent_at: string | null;
  expires_at: string | null;
}

function isDeliveredStatus(status: string): status is DeliveredStatus {
  return DELIVERED.has(status);
}

async function loadDelivered(db: D1Database): Promise<DeliveredPrompt[]> {
  const result = await db
    .prepare(
      `SELECT id, status, sent_at, expires_at
       FROM checkin_prompt
       WHERE status IN ('sent', 'answered', 'expired')
         AND sent_at IS NOT NULL`,
    )
    .all<PromptScanRow>();
  const delivered: DeliveredPrompt[] = [];
  for (const row of result.results ?? []) {
    if (!isDeliveredStatus(row.status)) {
      continue;
    }
    const dateKey = parsePromptDateKey(row.id);
    if (!dateKey) {
      log("warn", "health_prompt_unparsed", { prompt_id: row.id });
      continue;
    }
    delivered.push({
      dateKey,
      status: row.status,
      expiresAt: row.expires_at,
    });
  }
  return delivered;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mismatchFromUnknown(raw: unknown): boolean {
  if (!isRecord(raw)) {
    return false;
  }
  if (raw.source_count_mismatch === true) {
    return true;
  }
  if (!isRecord(raw.tables)) {
    return false;
  }
  for (const name of ["checkin_prompt", "checkin_response"]) {
    const table = raw.tables[name];
    if (isRecord(table) && table.source_count_mismatch === true) {
      return true;
    }
  }
  return false;
}

function parseManifestHead(slot: ExportSlot, body: string): ManifestHead | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(raw)) {
    return null;
  }
  const stamp = raw.extraction_timestamp;
  if (typeof stamp !== "string" || Number.isNaN(Date.parse(stamp))) {
    return null;
  }
  return {
    slot: {
      extractionDate: slot.extractionDate,
      objectTimestamp: slot.objectTimestamp,
    },
    extractionTimestamp: stamp,
    sourceCountMismatch: mismatchFromUnknown(raw),
  };
}

async function readObjectText(
  object: { arrayBuffer(): Promise<ArrayBuffer> },
): Promise<string> {
  return new TextDecoder().decode(await object.arrayBuffer());
}

async function loadExtract(
  bucket: R2Bucket | undefined,
  now: Date,
): Promise<ExtractFacts> {
  if (!bucket) {
    return { kind: "no-bucket" };
  }
  const manifests: ManifestHead[] = [];
  const unreadableKeys: string[] = [];
  try {
    const slots = recentExportSlots(now, FRESHNESS_LOOKBACK_DAYS);
    const reads = await Promise.all(
      slots.map(async (slot) => {
        const key = buildManifestObjectKey(slot);
        return { slot, key, object: await bucket.get(key) };
      }),
    );
    for (const { slot, key, object } of reads) {
      if (!object) {
        continue;
      }
      const head = parseManifestHead(slot, await readObjectText(object));
      if (!head) {
        log("error", "health_manifest_unreadable", { manifest_key: key });
        unreadableKeys.push(key);
        continue;
      }
      manifests.push(head);
    }
  } catch (error) {
    log("error", "health_extract_read_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      kind: "bucket",
      manifests,
      unreadableKeys:
        unreadableKeys.length > 0
          ? unreadableKeys
          : ["raw/cloudflare/checkins/manifests/"],
    };
  }
  return { kind: "bucket", manifests, unreadableKeys };
}

export async function loadHealthFacts(
  env: HealthFactsEnv,
  now: Date,
): Promise<HealthFacts> {
  const [delivered, extract] = await Promise.all([
    loadDelivered(env.DB),
    loadExtract(env.EXTRACT_BUCKET, now),
  ]);
  return {
    observedAt: now.toISOString(),
    delivered,
    extract,
  };
}
