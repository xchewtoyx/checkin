import { renderCheckinPage, renderRecordedPage } from "./checkin-page";
import { runAnalyticsExtract } from "./analytics-extract";
import {
  authorizeExport,
  parseExportQuery,
  serializeResponses,
} from "./export";
import { log } from "./logger";
import { NoopNotifier, Notifier, PushoverNotifier } from "./notifier";
import { recordResponse } from "./record-response";
import { runScheduler, SchedulerEnv } from "./scheduler";
import { getPromptByToken, listResponses } from "./store";

export interface Env extends SchedulerEnv {
  PUSHOVER_TOKEN?: string;
  PUSHOVER_USER?: string;
  EXPORT_BEARER_TOKEN?: string;
  EXTRACT_BUCKET?: R2Bucket;
}

function buildNotifier(env: Env): Notifier {
  if (env.PUSHOVER_TOKEN && env.PUSHOVER_USER) {
    return new PushoverNotifier(env.PUSHOVER_TOKEN, env.PUSHOVER_USER);
  }
  return new NoopNotifier();
}

async function handleExportResponses(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!authorizeExport(request, env.EXPORT_BEARER_TOKEN)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const query = parseExportQuery(url);
  if ("error" in query) {
    return new Response(query.error, { status: 400 });
  }

  const rows = await listResponses(env.DB, query.from, query.to);
  log("info", "responses_exported", { count: rows.length });
  return new Response(serializeResponses(rows), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleCheckinToken(
  request: Request,
  env: Env,
  token: string,
): Promise<Response> {
  const prompt = await getPromptByToken(env.DB, token);
  if (!prompt) {
    return new Response("Not found", { status: 404 });
  }

  const now = new Date();

  if (request.method === "GET") {
    return new Response(renderCheckinPage(prompt, now), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const payload = (await request.json()) as {
    feeling?: string;
    intensity?: number;
    note?: string;
    confidence?: string | null;
    vocab_era?: string | null;
  };

  if (!payload.feeling || payload.intensity === undefined) {
    return new Response("Invalid request", { status: 400 });
  }

  const result = await recordResponse(env.DB, {
    token,
    feeling: payload.feeling,
    intensity: Number(payload.intensity),
    note: payload.note,
    confidence: payload.confidence,
    vocabEra: payload.vocab_era,
    now,
  });

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 400;
    return new Response("Unavailable", { status });
  }

  return new Response(renderRecordedPage(), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    if (url.pathname === "/api/responses") {
      return handleExportResponses(request, env);
    }

    const tokenMatch = url.pathname.match(/^\/c\/([a-f0-9]+)$/);
    if (tokenMatch) {
      return handleCheckinToken(request, env, tokenMatch[1]);
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const now = new Date();
    log("info", "scheduler_run", {});
    await runScheduler(env, buildNotifier(env), now);

    try {
      await runAnalyticsExtract(env, now);
    } catch (error) {
      log("error", "analytics_extract_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  },
};
