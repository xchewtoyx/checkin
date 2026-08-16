import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  AnalyticsExtractEnv,
  buildExportSlot,
  buildManifestObjectKey,
  buildTableObjectKey,
  countJsonlLines,
  executeAnalyticsExtract,
  gunzipText,
  runAnalyticsExtract,
  shouldRunExport,
} from "../src/analytics-extract";
import { NoopNotifier } from "../src/notifier";
import { runScheduler } from "../src/scheduler";

class MemoryR2Object {
  constructor(private readonly data: ArrayBuffer) {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data.slice(0);
  }
}

class MemoryR2Bucket {
  private readonly objects = new Map<string, ArrayBuffer>();

  async put(key: string, value: ArrayBuffer | string): Promise<void> {
    const buffer =
      typeof value === "string"
        ? new TextEncoder().encode(value).buffer
        : value;
    this.objects.set(key, buffer as ArrayBuffer);
  }

  async get(key: string): Promise<MemoryR2Object | null> {
    const data = this.objects.get(key);
    return data ? new MemoryR2Object(data) : null;
  }

  async list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }> {
    const prefix = options?.prefix ?? "";
    const objects = [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({ key }));
    return { objects };
  }
}

function createExtractEnv(bucket: R2Bucket): AnalyticsExtractEnv {
  return { DB: env.DB, EXTRACT_BUCKET: bucket };
}

async function seedPromptAndResponse(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO checkin_prompt
     (id, scheduled_for, sent_at, expires_at, response_token, notification_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      "prompt-test-1",
      "2026-08-15T09:00:00.000Z",
      "2026-08-15T09:01:00.000Z",
      "2026-08-16T01:01:00.000Z",
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      "pushover-msg-123",
      "sent",
      "2026-08-15T09:00:00.000Z",
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO checkin_response
     (id, prompt_id, feeling, intensity, note, confidence, observed_at, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      "response-test-1",
      "prompt-test-1",
      "calm",
      7,
      "after a walk",
      "weak",
      "2026-08-15T09:05:00.000Z",
      "2026-08-15T09:05:01.000Z",
    )
    .run();
}

describe("analytics extract slot gating", () => {
  it("runs only inside the daily export windows", () => {
    expect(shouldRunExport(new Date("2026-08-15T02:59:00.000Z"))).toBeNull();
    expect(shouldRunExport(new Date("2026-08-15T03:00:00.000Z"))?.objectTimestamp).toBe(
      "030000",
    );
    expect(shouldRunExport(new Date("2026-08-15T03:14:59.000Z"))?.objectTimestamp).toBe(
      "030000",
    );
    expect(shouldRunExport(new Date("2026-08-15T03:15:00.000Z"))).toBeNull();
    expect(shouldRunExport(new Date("2026-08-15T12:00:00.000Z"))).toBeNull();
    expect(shouldRunExport(new Date("2026-08-15T15:00:00.000Z"))?.objectTimestamp).toBe(
      "150000",
    );
    expect(shouldRunExport(new Date("2026-08-15T15:14:59.000Z"))?.objectTimestamp).toBe(
      "150000",
    );
    expect(shouldRunExport(new Date("2026-08-15T15:15:00.000Z"))).toBeNull();
  });

  it("keys object paths to the scheduled slot time, not wall clock", () => {
    const morning = buildExportSlot(new Date("2026-08-15T03:05:00.000Z"), 3, 0);
    expect(buildTableObjectKey("checkin_prompt", morning)).toBe(
      "raw/cloudflare/checkins/checkin_prompt/extraction_date=2026-08-15/030000.jsonl.gz",
    );
    expect(buildManifestObjectKey(morning)).toBe(
      "raw/cloudflare/checkins/manifests/extraction_date=2026-08-15/030000.json",
    );

    const afternoon = buildExportSlot(new Date("2026-08-15T15:05:00.000Z"), 15, 0);
    expect(buildTableObjectKey("checkin_prompt", afternoon)).toBe(
      "raw/cloudflare/checkins/checkin_prompt/extraction_date=2026-08-15/150000.jsonl.gz",
    );
  });

  it("writes separate file sets for each daily slot", async () => {
    const bucket = new MemoryR2Bucket() as unknown as R2Bucket;
    await seedPromptAndResponse();
    const extractEnv = createExtractEnv(bucket);
    const day = new Date("2026-08-17T03:05:00.000Z");

    await executeAnalyticsExtract(
      extractEnv,
      buildExportSlot(day, 3, 0),
      new Date("2026-08-17T03:05:00.000Z"),
    );
    await executeAnalyticsExtract(
      extractEnv,
      buildExportSlot(day, 15, 0),
      new Date("2026-08-17T15:05:00.000Z"),
    );

    const listed = await bucket.list({
      prefix: "raw/cloudflare/checkins/checkin_prompt/extraction_date=2026-08-17/",
    });
    expect(listed.objects).toHaveLength(2);
  });
});

describe("analytics extract snapshot", () => {
  it("writes gzipped JSONL snapshots and a manifest with matching counts", async () => {
    const bucket = new MemoryR2Bucket() as unknown as R2Bucket;
    await seedPromptAndResponse();

    const now = new Date("2026-08-15T03:05:00.000Z");
    const slot = buildExportSlot(now, 3, 0);
    const manifest = await executeAnalyticsExtract(createExtractEnv(bucket), slot, now);

    expect(manifest.tables.checkin_prompt.row_count).toBe(1);
    expect(manifest.tables.checkin_response.row_count).toBe(1);

    const promptObject = await bucket.get(manifest.tables.checkin_prompt.object_key);
    const responseObject = await bucket.get(manifest.tables.checkin_response.object_key);
    expect(promptObject).not.toBeNull();
    expect(responseObject).not.toBeNull();

    const promptBuffer = await promptObject!.arrayBuffer();
    const responseBuffer = await responseObject!.arrayBuffer();

    expect(await countJsonlLines(promptBuffer)).toBe(1);
    expect(await countJsonlLines(responseBuffer)).toBe(1);

    const parsedPrompt = JSON.parse((await gunzipText(promptBuffer)).trim());
    expect(parsedPrompt).toMatchObject({
      id: "prompt-test-1",
      status: "sent",
    });
    expect(parsedPrompt).not.toHaveProperty("response_token");
    expect(parsedPrompt).not.toHaveProperty("notification_id");

    const parsedResponse = JSON.parse((await gunzipText(responseBuffer)).trim());
    expect(parsedResponse).toMatchObject({
      id: "response-test-1",
      note: "after a walk",
      confidence: "weak",
    });

    const manifestObject = await bucket.get(buildManifestObjectKey(slot));
    expect(manifestObject).not.toBeNull();
  });

  it("is idempotent for the same slot — one file set after N invocations", async () => {
    const bucket = new MemoryR2Bucket() as unknown as R2Bucket;

    await env.DB.prepare("DELETE FROM checkin_response").run();
    await env.DB.prepare("DELETE FROM checkin_prompt").run();
    await seedPromptAndResponse();

    const now = new Date("2026-08-16T03:05:00.000Z");
    const slot = buildExportSlot(now, 3, 0);
    const extractEnv = createExtractEnv(bucket);

    await executeAnalyticsExtract(extractEnv, slot, now);
    await executeAnalyticsExtract(extractEnv, slot, now);
    await executeAnalyticsExtract(extractEnv, slot, now);

    const listed = await bucket.list({
      prefix: `raw/cloudflare/checkins/checkin_prompt/extraction_date=${slot.extractionDate}/`,
    });
    expect(listed.objects).toHaveLength(1);
  });

  it("skips outside the export window via runAnalyticsExtract", async () => {
    const bucket = new MemoryR2Bucket() as unknown as R2Bucket;
    const result = await runAnalyticsExtract(
      createExtractEnv(bucket),
      new Date("2026-08-15T12:00:00.000Z"),
    );
    expect(result).toEqual({ skipped: true, reason: "outside_export_window" });
  });
});

describe("analytics extract loop isolation", () => {
  it("does not block the scheduler when R2 writes fail", async () => {
    const failingBucket = {
      put: async () => {
        throw new Error("r2 unavailable");
      },
      get: async () => null,
      list: async () => ({ objects: [] }),
    } as unknown as R2Bucket;

    const extractEnv = { ...env, EXTRACT_BUCKET: failingBucket };
    const notifier = new NoopNotifier();
    const now = new Date("2026-08-13T09:45:00.000Z");

    await expect(runScheduler(extractEnv, notifier, now)).resolves.toBeUndefined();

    await expect(
      executeAnalyticsExtract(
        extractEnv,
        buildExportSlot(now, 3, 0),
        now,
      ),
    ).rejects.toThrow("r2 unavailable");
  });
});
