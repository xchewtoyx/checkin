import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { buildManifestObjectKey, buildExportSlot } from "../src/analytics-extract";
import { loadHealthFacts } from "../src/health-facts";
import {
  FRESHNESS_LOOKBACK_DAYS,
  assessHealth,
  dueExportSlots,
} from "../src/health-strip";

class MemoryR2Object {
  constructor(private readonly data: ArrayBuffer) {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data.slice(0);
  }
}

class MemoryR2Bucket {
  private readonly objects = new Map<string, ArrayBuffer>();
  failGet = false;

  async put(key: string, value: ArrayBuffer | string): Promise<void> {
    const buffer =
      typeof value === "string" ? new TextEncoder().encode(value).buffer : value;
    this.objects.set(key, buffer as ArrayBuffer);
  }

  async get(key: string): Promise<MemoryR2Object | null> {
    if (this.failGet) {
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
      await bucket.put(
        buildManifestObjectKey(slot),
        JSON.stringify({
          extraction_timestamp: new Date(
            slot.scheduledAt.getTime() + 3 * 60_000,
          ).toISOString(),
          source_count_mismatch: false,
          tables: {
            checkin_prompt: { source_count_mismatch: false },
            checkin_response: { source_count_mismatch: false },
          },
        }),
      );
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
    await bucket.put(
      buildManifestObjectKey(oldSlot),
      JSON.stringify({
        extraction_timestamp: "2026-09-18T03:03:00.000Z",
        source_count_mismatch: false,
      }),
    );

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

  it("records a corrupt due manifest as unreadable rather than missed", async () => {
    const bucket = new MemoryR2Bucket();
    const due = dueExportSlots(NOW, FRESHNESS_LOOKBACK_DAYS);
    const corrupt = due[due.length - 1];
    for (const slot of due) {
      if (slot === corrupt) {
        continue;
      }
      await bucket.put(
        buildManifestObjectKey(slot),
        JSON.stringify({
          extraction_timestamp: new Date(
            slot.scheduledAt.getTime() + 3 * 60_000,
          ).toISOString(),
        }),
      );
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
      JSON.stringify({
        extraction_timestamp: "2026-09-28T15:03:00.000Z",
        tables: {
          checkin_prompt: { source_count_mismatch: true },
          checkin_response: { source_count_mismatch: false },
        },
      }),
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

  it("does not throw when the extract bucket fails, and records the read as unreadable", async () => {
    const bucket = new MemoryR2Bucket();
    bucket.failGet = true;
    const loaded = await loadHealthFacts(
      { DB: env.DB, EXTRACT_BUCKET: bucket as unknown as R2Bucket },
      NOW,
    );
    expect(loaded.extract).toEqual({
      kind: "bucket",
      manifests: [],
      unreadableKeys: ["raw/cloudflare/checkins/manifests/"],
    });
    expect(assessHealth(loaded).extract).toMatchObject({
      kind: "unreadable",
      key: "raw/cloudflare/checkins/manifests/",
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
