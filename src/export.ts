import { ResponseRow } from "./store";

export function parseBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function authorizeExport(
  request: Request,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken) {
    return false;
  }
  const token = parseBearerToken(request);
  return token === expectedToken;
}

export interface ExportQuery {
  from?: string;
  to?: string;
}

export function parseExportQuery(url: URL): ExportQuery | { error: string } {
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;

  if (from && Number.isNaN(Date.parse(from))) {
    return { error: "Invalid from parameter" };
  }
  if (to && Number.isNaN(Date.parse(to))) {
    return { error: "Invalid to parameter" };
  }

  return { from, to };
}

export function serializeResponses(rows: ResponseRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      prompt_id: row.prompt_id,
      feeling: row.feeling,
      intensity: row.intensity,
      note: row.note,
      confidence: row.confidence,
      vocab_era: row.vocab_era,
      observed_at: row.observed_at,
      submitted_at: row.submitted_at,
    })),
  );
}
