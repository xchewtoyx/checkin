import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ExportSlot,
  buildManifestObjectKey,
  buildExportSlot,
} from "../src/analytics-extract";
import { loadHealthFacts } from "../src/health-facts";
import {
  FRESHNESS_LOOKBACK_DAYS,
  assessHealth,
  dueExportSlots,
  recentExportSlots,
  renderHealthStrip,
} from "../src/health-strip";

function manifestBody(
  slot: ExportSlot,
  options: {
    extractionTimestamp?: string;
    promptMismatch?: boolean;
    responseMismatch?: boolean;
  } = {},
): string {
  const tableEntry = (table: string, mismatch: boolean) => ({
    row_count: 1,
    source_row_count: mismatch ? 2 : 1,
    object_key: `raw/cloudflare/checkins/${table}/extraction_date=${slot.extractionDate}/${slot.objectTimestamp}.jsonl.gz`,
    source_count_mismatch: mismatch,
  });
  const promptMismatch = options.promptMismatch ?? false;
  const responseMismatch = options.responseMismatch ?? false;
  return JSON.stringify({
    manifest_version: 2,
    extraction_timestamp:
      options.extractionTimestamp ??
      new Date(slot.scheduledAt.getTime() + 3 * 60_000).toISOString(),
    source_count_mismatch: promptMismatch || responseMismatch,
    tables: {
      checkin_prompt: tableEntry("checkin_prompt", promptMismatch),
      checkin_response: tableEntry("checkin_response", responseMismatch),
    },
  });
}

class MemoryR2Object {
  constructor(private readonly data: ArrayBuffer) {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data.slice(0);
  }
}

class MemoryR2Bucket {
  private readonly objects = new Map<string, ArrayBuffer>();
  failGet = false;
  readonly failKeys = new Set<string>();

  async put(key: string, value: ArrayBuffer | string): Promise<void> {
    const buffer =
      typeof value === "string" ? new TextEncoder().encode(value).buffer : value;
    this.objects.set(key, buffer as ArrayBuffer);
  }

  async get(key: string): Promise<MemoryR2Object | null> {
    if (this.failGet || this.failKeys.has(key)) {
      throw new Error("r2 unavailable");
    }
    const data = this.objects.get(key);
    return data ? new MemoryR2Object(data) : null;
  }

  async list(options: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor?: string;
  }> {
    if (this.failGet) {
      throw new Error("r2 unavailable");
    }
    const keys = [...this.objects.keys()]
      .filter((key) => !options.prefix || key.startsWith(options.prefix))
      .sort();
    const start = options.cursor === undefined ? 0 : Number(options.cursor);
    const limit = options.limit ?? 1000;
    const page = keys.slice(start, start + limit);
    const truncated = start + limit < keys.length;
    return {
      objects: page.map((key) => ({ key })),
      truncated,
      cursor: truncated ? String(start + limit) : undefined,
    };
  }
}

const NOW = new Date("2026-09-28T16:00:00.000Z");

async function insertPrompt(params: {
  id: string;
  status: string;
  sentAt: string | null;
  expiresAt: string | null;
  token: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO checkin_prompt
     (id, scheduled_for, sent_at, expires_at, response_token, notification_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      params.id,
      "2026-09-20T08:00:00.000Z",
      params.sentAt,
      params.expiresAt,
      params.token,
      "noop",
      params.status,
      "2026-09-20T08:00:00.000Z",
    )
    .run();
}

describe("loadHealthFacts", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM checkin_response").run();
    await env.DB.prepare("DELETE FROM checkin_prompt").run();
  });

  it("loads closed delivered prompts and the latest readable manifest", async () => {
    await insertPrompt({
      id: "prompt-2026-09-20-w1",
      status: "answered",
      sentAt: "2026-09-20T08:01:00.000Z",
      expiresAt: "2026-09-20T20:01:00.000Z",
      token: "token-answered",
    });
    await insertPrompt({
      id: "prompt-2026-09-20-w2",
      status: "expired",
      sentAt: "2026-09-20T12:01:00.000Z",
      expiresAt: "2026-09-21T00:01:00.000Z",
      token: "token-expired",
    });
    await insertPrompt({
      id: "prompt-2026-09-20-w3",
      status: "failed",
      sentAt: "2026-09-20T08:01:00.000Z",
      expiresAt: "2026-09-20T20:01:00.000Z",
      token: "token-failed",
    });
    await insertPrompt({
      id: "prompt-scheduled",
      status: "scheduled",
      sentAt: null,
      expiresAt: null,
      token: "token-scheduled",
    });

    const bucket = new MemoryR2Bucket();
    for (const slot of dueExportSlots(NOW, FRESHNESS_LOOKBACK_DAYS)) {
      await bucket.put(buildManifestObjectKey(slot), manifestBody(slot));
    }

    const loaded = await loadHealthFacts(
      { DB: env.DB, EXTRACT_BUCKET: bucket as unknown as R2Bucket },
      NOW,
    );
    expect(loaded.delivered).toHaveLength(2);
    expect(loaded.delivered).toEqual(
      expect.arrayContaining([
        {
          dateKey: "2026-09-20",
          status: "answered",
          expiresAt: "2026-09-20T20:01:00.000Z",
        },
        {
          dateKey: "2026-09-20",
          status: "expired",
          expiresAt: "2026-09-21T00:01:00.000Z",
        },
      ]),
    );

    const strip = assessHealth(loaded);
    expect(strip.answer).toMatchObject({
      kind: "measured",
      answered: 1,
      sent: 2,
      percent: 50,
      band: "friction",
    });
    expect(strip.extract).toMatchObject({
      kind: "landed",
      refreshedAt: "2026-09-28T15:03:00.000Z",
      freshness: { kind: "current" },
      integrity: "match",
    });
  });

  it("keeps the last refresh when the newest manifest is beyond the probe window", async () => {
    const bucket = new MemoryR2Bucket();
    const oldSlot = buildExportSlot(new Date("2026-09-18T00:00:00.000Z"), 3, 0);
    await bucket.put(buildManifestObjectKey(oldSlot), manifestBody(oldSlot));

    const loaded = await loadHealthFacts(
      { DB: env.DB, EXTRACT_BUCKET: bucket as unknown as R2Bucket },
      NOW,
    );
    expect(loaded.extract).toMatchObject({
      kind: "bucket",
      manifests: [
        {
          slot: { extractionDate: "2026-09-18", objectTimestamp: "030000" },
          extractionTimestamp: "2026-09-18T03:03:00.000Z",
        },
      ],
    });

    const strip = assessHealth(loaded);
    if (strip.extract.kind !== "landed") {
      throw new Error("expected landed extract");
    }
    expect(strip.extract.refreshedAt).toBe("2026-09-18T03:03:00.000Z");
    expect(strip.extract.freshness.kind).toBe("stale");
    if (strip.extract.freshness.kind === "stale") {
      expect(strip.extract.freshness.causes).toContainEqual({
        kind: "older-than-24h",
      });
      expect(
        strip.extract.freshness.causes.filter(
          (cause) => cause.kind === "missed-slot",
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it("finds the last readable manifest behind a corrupt recent one", async () => {
    const bucket = new MemoryR2Bucket();
    const due = dueExportSlots(NOW, FRESHNESS_LOOKBACK_DAYS);
    const corrupt = due[due.length - 1];
    await bucket.put(buildManifestObjectKey(corrupt), "not json{");
    const oldSlot = buildExportSlot(new Date("2026-09-18T00:00:00.000Z"), 3, 0);
    await bucket.put(buildManifestObjectKey(oldSlot), manifestBody(oldSlot));

    const loaded = await loadHealthFacts(
      { DB: env.DB, EXTRACT_BUCKET: bucket as unknown as R2Bucket },
      NOW,
    );
    if (loaded.extract.kind !== "bucket") {
      throw new Error("expected bucket facts");
    }
    expect(loaded.extract.manifests).toHaveLength(1);
    expect(loaded.extract.manifests[0].extractionTimestamp).toBe(
      "2026-09-18T03:03:00.000Z",
    );
    expect(loaded.extract.unreadableKeys).toEqual([
      buildManifestObjectKey(corrupt),
    ]);

    const strip = assessHealth(loaded);
    if (
      strip.extract.kind !== "landed" ||
      strip.extract.freshness.kind !== "stale"
    ) {
      throw new Error("expected landed extract with stale freshness");
    }
    expect(strip.extract.refreshedAt).toBe("2026-09-18T03:03:00.000Z");
    expect(strip.extract.freshness.causes).toContainEqual({
      kind: "unreadable-manifest",
      slot: {
        extractionDate: corrupt.extractionDate,
        objectTimestamp: corrupt.objectTimestamp,
      },
      key: buildManifestObjectKey(corrupt),
    });
    expect(strip.extract.freshness.causes).toContainEqual({
      kind: "older-than-24h",
    });
  });

  it("treats a manifest missing table metadata as unreadable", async () => {
    const bucket = new MemoryR2Bucket();
    const due = dueExportSlots(NOW, FRESHNESS_LOOKBACK_DAYS);
    const incomplete = due[due.length - 1];
    for (const slot of due) {
      if (slot === incomplete) {
        continue;
      }
      await bucket.put(buildManifestObjectKey(slot), manifestBody(slot));
    }
    await bucket.put(
      buildManifestObjectKey(incomplete),
      JSON.stringify({ extraction_timestamp: "2026-09-28T15:03:00.000Z" }),
    );

    const loaded = await loadHealthFacts(
      { DB: env.DB, EXTRACT_BUCKET: bucket as unknown as R2Bucket },
      NOW,
    );
    if (loaded.extract.kind !== "bucket") {
      throw new Error("expected bucket facts");
    }
    expect(loaded.extract.unreadableKeys).toEqual([
      buildManifestObjectKey(incomplete),
    ]);

    const strip = assessHealth(loaded);
    if (
      strip.extract.kind !== "landed" ||
      strip.extract.freshness.kind !== "stale"
    ) {
      throw new Error("expected landed extract with stale freshness");
    }
    expect(strip.extract.freshness.causes).toEqual([
      {
        kind: "unreadable-manifest",
        slot: {
          extractionDate: incomplete.extractionDate,
          objectTimestamp: incomplete.objectTimestamp,
        },
        key: buildManifestObjectKey(incomplete),
      },
    ]);
  });

  it("records a corrupt due manifest as unreadable rather than missed", async () => {
    const bucket = new MemoryR2Bucket();
    const due = dueExportSlots(NOW, FRESHNESS_LOOKBACK_DAYS);
    const corrupt = due[due.length - 1];
    for (const slot of due) {
      if (slot === corrupt) {
        continue;
      }
      await bucket.put(buildManifestObjectKey(slot), manifestBody(slot));
    }
    await bucket.put(buildManifestObjectKey(corrupt), "not json{");

    const loaded = await loadHealthFacts(
      { DB: env.DB, EXTRACT_BUCKET: bucket as unknown as R2Bucket },
      NOW,
    );
    if (loaded.extract.kind !== "bucket") {
      throw new Error("expected bucket facts");
    }
    expect(loaded.extract.unreadableKeys).toEqual([
      buildManifestObjectKey(corrupt),
    ]);

    const strip = assessHealth(loaded);
    if (
      strip.extract.kind !== "landed" ||
      strip.extract.freshness.kind !== "stale"
    ) {
      throw new Error("expected landed extract with stale freshness");
    }
    expect(strip.extract.freshness.causes).toEqual([
      {
        kind: "unreadable-manifest",
        slot: {
          extractionDate: corrupt.extractionDate,
          objectTimestamp: corrupt.objectTimestamp,
        },
        key: buildManifestObjectKey(corrupt),
      },
    ]);
  });

  it("treats a table-level source_count_mismatch as mismatch", async () => {
    const bucket = new MemoryR2Bucket();
    const slot = buildExportSlot(NOW, 15, 0);
    await bucket.put(
      buildManifestObjectKey(slot),
      manifestBody(slot, { promptMismatch: true }),
    );

    const loaded = await loadHealthFacts(
      { DB: env.DB, EXTRACT_BUCKET: bucket as unknown as R2Bucket },
      NOW,
    );
    expect(assessHealth(loaded).extract).toMatchObject({
      kind: "landed",
      integrity: "mismatch",
    });
  });

  it("keeps landed manifests when a single slot read fails", async () => {
    const bucket = new MemoryR2Bucket();
    const due = dueExportSlots(NOW, FRESHNESS_LOOKBACK_DAYS);
    for (const slot of due) {
      await bucket.put(buildManifestObjectKey(slot), manifestBody(slot));
    }
    const failed = due[0];
    bucket.failKeys.add(buildManifestObjectKey(failed));

    const loaded = await loadHealthFacts(
      { DB: env.DB, EXTRACT_BUCKET: bucket as unknown as R2Bucket },
      NOW,
    );
    if (loaded.extract.kind !== "bucket") {
      throw new Error("expected bucket facts");
    }
    expect(loaded.extract.manifests).toHaveLength(due.length - 1);
    expect(loaded.extract.unreadableKeys).toEqual([
      buildManifestObjectKey(failed),
    ]);

    const strip = assessHealth(loaded);
    if (
      strip.extract.kind !== "landed" ||
      strip.extract.freshness.kind !== "stale"
    ) {
      throw new Error("expected landed extract with stale freshness");
    }
    expect(strip.extract.refreshedAt).toBe("2026-09-28T15:03:00.000Z");
    expect(strip.extract.freshness.causes).toEqual([
      {
        kind: "unreadable-manifest",
        slot: {
          extractionDate: failed.extractionDate,
          objectTimestamp: failed.objectTimestamp,
        },
        key: buildManifestObjectKey(failed),
      },
    ]);
  });

  it("marks a version-one manifest's integrity as unknown", async () => {
    const bucket = new MemoryR2Bucket();
    const due = dueExportSlots(NOW, FRESHNESS_LOOKBACK_DAYS);
    const v1Slot = due[due.length - 1];
    for (const slot of due) {
      if (slot === v1Slot) {
        continue;
      }
      await bucket.put(buildManifestObjectKey(slot), manifestBody(slot));
    }
    const v1Table = (table: string) => ({
      row_count: 1,
      object_key: `raw/cloudflare/checkins/${table}/extraction_date=${v1Slot.extractionDate}/${v1Slot.objectTimestamp}.jsonl.gz`,
    });
    await bucket.put(
      buildManifestObjectKey(v1Slot),
      JSON.stringify({
        extraction_timestamp: "2026-09-28T15:03:00.000Z",
        tables: {
          checkin_prompt: v1Table("checkin_prompt"),
          checkin_response: v1Table("checkin_response"),
        },
      }),
    );

    const loaded = await loadHealthFacts(
      { DB: env.DB, EXTRACT_BUCKET: bucket as unknown as R2Bucket },
      NOW,
    );
    const strip = assessHealth(loaded);
    expect(strip.extract).toMatchObject({
      kind: "landed",
      integrity: "unknown",
      freshness: { kind: "current" },
    });
    expect(strip.glance).toBe("attention");
    expect(renderHealthStrip(strip)).toContain("Source counts unverified");
    expect(renderHealthStrip(strip)).toContain('data-integrity="unknown"');
  });

  it("does not throw when the extract bucket fails, and records the read as unreadable", async () => {
    const bucket = new MemoryR2Bucket();
    bucket.failGet = true;
    const loaded = await loadHealthFacts(
      { DB: env.DB, EXTRACT_BUCKET: bucket as unknown as R2Bucket },
      NOW,
    );
    const expectedKeys = recentExportSlots(NOW, FRESHNESS_LOOKBACK_DAYS).map(
      (slot) => buildManifestObjectKey(slot),
    );
    expect(loaded.extract).toEqual({
      kind: "bucket",
      manifests: [],
      unreadableKeys: expectedKeys,
    });
    expect(assessHealth(loaded).extract).toMatchObject({
      kind: "unreadable",
      key: expectedKeys[0],
    });
  });

  it("returns no-bucket when EXTRACT_BUCKET is unbound", async () => {
    const loaded = await loadHealthFacts({ DB: env.DB }, NOW);
    expect(loaded.extract).toEqual({ kind: "no-bucket" });
    expect(assessHealth(loaded).extract).toEqual({
      kind: "absent",
      reason: "no-bucket",
    });
  });
});
