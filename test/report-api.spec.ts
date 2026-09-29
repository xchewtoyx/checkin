import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ExportSlot,
  buildExportSlot,
  buildManifestObjectKey,
} from "../src/analytics-extract";
import { REPORT_AUTH_CHALLENGE } from "../src/export";
import { getLondonParts } from "../src/london-time";
import {
  FRESHNESS_LOOKBACK_DAYS,
  latestDueSlot,
  recentExportSlots,
} from "../src/health-strip";

function manifestBody(
  slot: ExportSlot,
  overrides: Record<string, unknown> = {},
): string {
  const tableEntry = (table: string) => ({
    row_count: 1,
    source_row_count: 1,
    object_key: `raw/cloudflare/checkins/${table}/extraction_date=${slot.extractionDate}/${slot.objectTimestamp}.jsonl.gz`,
    source_count_mismatch: false,
  });
  return JSON.stringify({
    manifest_version: 2,
    extraction_timestamp: new Date(
      slot.scheduledAt.getTime() + 3 * 60_000,
    ).toISOString(),
    source_count_mismatch: false,
    tables: {
      checkin_prompt: tableEntry("checkin_prompt"),
      checkin_response: tableEntry("checkin_response"),
    },
    ...overrides,
  });
}

const exportToken = "test-export-token";

function bearerHeaders(): HeadersInit {
  return { authorization: `Bearer ${exportToken}` };
}

function basicHeaders(user = "report"): HeadersInit {
  return { authorization: `Basic ${btoa(`${user}:${exportToken}`)}` };
}

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
      params.sentAt ?? "2026-09-20T08:00:00.000Z",
      params.sentAt,
      params.expiresAt,
      params.token,
      "secret-notification",
      params.status,
      params.sentAt ?? "2026-09-20T08:00:00.000Z",
    )
    .run();
}

async function extractBucket(): Promise<R2Bucket> {
  const bucket = env.EXTRACT_BUCKET;
  if (!bucket) {
    throw new Error("EXTRACT_BUCKET binding missing");
  }
  return bucket;
}

async function clearManifests(): Promise<void> {
  const bucket = await extractBucket();
  const listed = await bucket.list({
    prefix: "raw/cloudflare/checkins/manifests/",
  });
  await Promise.all(listed.objects.map((object) => bucket.delete(object.key)));
}

async function putDueManifest(overrides: Record<string, unknown>): Promise<string> {
  const bucket = await extractBucket();
  const now = new Date();
  const due = latestDueSlot(now);
  const slot = due
    ? {
        scheduledAt: now,
        extractionDate: due.extractionDate,
        objectTimestamp: due.objectTimestamp,
      }
    : buildExportSlot(now, 3, 0);
  const key = buildManifestObjectKey(slot);
  await bucket.put(key, manifestBody(slot, overrides));
  return key;
}

async function putAllRecentManifests(): Promise<void> {
  const bucket = await extractBucket();
  const now = new Date();
  for (const slot of recentExportSlots(now, FRESHNESS_LOOKBACK_DAYS)) {
    await bucket.put(buildManifestObjectKey(slot), manifestBody(slot));
  }
}

describe("GET /report", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM checkin_response").run();
    await env.DB.prepare("DELETE FROM checkin_prompt").run();
    await clearManifests();
  });

  it("challenges unauthenticated browsers with Basic", async () => {
    const response = await SELF.fetch("http://example.com/report");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(REPORT_AUTH_CHALLENGE);
  });

  it("rejects a wrong bearer token", async () => {
    const response = await SELF.fetch("http://example.com/report", {
      headers: { authorization: "Bearer no" },
    });
    expect(response.status).toBe(401);
  });

  it("rejects POST", async () => {
    const response = await SELF.fetch("http://example.com/report", {
      method: "POST",
      headers: bearerHeaders(),
    });
    expect(response.status).toBe(405);
  });

  it("renders absent, not 0%, when there are no closed prompts and no extract", async () => {
    const response = await SELF.fetch("http://example.com/report", {
      headers: bearerHeaders(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const html = await response.text();
    expect(html).toContain("data-glance=\"absent\"");
    expect(html).toContain("data-answer=\"absent\"");
    expect(html).toContain("data-extract=\"absent\"");
    expect(html).toContain("14 London days");
    expect(html).not.toMatch(/\d+%/);
    expect(html).not.toContain("0/0");
  });

  it("accepts Basic auth with the export token as the password", async () => {
    const response = await SELF.fetch("http://example.com/report", {
      headers: basicHeaders("ignored"),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Is the instrument healthy?");
  });

  it("shows a measured rate with denominator from live D1 and a current extract", async () => {
    const londonDate = getLondonParts(new Date()).dateKey;
    await insertPrompt({
      id: `prompt-${londonDate}-w1`,
      status: "answered",
      sentAt: `${londonDate}T08:01:00.000Z`,
      expiresAt: `${londonDate}T20:01:00.000Z`,
      token: "live-answered-1",
    });
    await insertPrompt({
      id: `prompt-${londonDate}-w2`,
      status: "answered",
      sentAt: `${londonDate}T12:01:00.000Z`,
      expiresAt: `${londonDate}T23:01:00.000Z`,
      token: "live-answered-2",
    });
    await insertPrompt({
      id: `prompt-${londonDate}-w3`,
      status: "expired",
      sentAt: `${londonDate}T16:01:00.000Z`,
      expiresAt: `${londonDate}T22:01:00.000Z`,
      token: "live-expired",
    });
    await insertPrompt({
      id: `prompt-${londonDate}-w4`,
      status: "sent",
      sentAt: `${londonDate}T17:01:00.000Z`,
      expiresAt: "2099-01-01T00:00:00.000Z",
      token: "live-open",
    });

    await putAllRecentManifests();

    const response = await SELF.fetch("http://example.com/report", {
      headers: bearerHeaders(),
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("2/3 · 66% · Friction review");
    expect(html).toContain("data-band=\"friction\"");
    expect(html).toContain("data-freshness=\"current\"");
    expect(html).not.toContain("live-answered-1");
    expect(html).not.toContain("secret-notification");
  });

  it("flags a stale extract with source-count mismatch", async () => {
    await putDueManifest({
      extraction_timestamp: "2020-01-01T00:00:00.000Z",
      source_count_mismatch: true,
    });

    const response = await SELF.fetch("http://example.com/report", {
      headers: bearerHeaders(),
    });
    const html = await response.text();
    expect(html).toContain("older than 24h");
    expect(html).toContain("Source count mismatch");
    expect(html).toContain("data-glance=\"attention\"");
  });
});
