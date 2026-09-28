import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { buildManifestObjectKey, buildExportSlot } from "../src/analytics-extract";
import { loadHealthFacts } from "../src/health-facts";
import { assessHealth } from "../src/health-strip";

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
    const slot = buildExportSlot(NOW, 15, 0);
    await bucket.put(
      buildManifestObjectKey(slot),
      JSON.stringify({
        extraction_timestamp: "2026-09-28T15:03:00.000Z",
        source_count_mismatch: false,
        tables: {
          checkin_prompt: { source_count_mismatch: false },
          checkin_response: { source_count_mismatch: false },
        },
      }),
    );

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
