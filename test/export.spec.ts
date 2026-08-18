import { describe, expect, it } from "vitest";
import {
  authorizeExport,
  parseBearerToken,
  parseExportQuery,
  serializeResponses,
} from "../src/export";

describe("export auth", () => {
  it("parses bearer tokens", () => {
    const request = new Request("http://example.com/api/responses", {
      headers: { authorization: "Bearer secret-token" },
    });
    expect(parseBearerToken(request)).toBe("secret-token");
  });

  it("rejects missing authorization", () => {
    const request = new Request("http://example.com/api/responses");
    expect(authorizeExport(request, "secret-token")).toBe(false);
  });

  it("accepts matching bearer token", () => {
    const request = new Request("http://example.com/api/responses", {
      headers: { authorization: "Bearer secret-token" },
    });
    expect(authorizeExport(request, "secret-token")).toBe(true);
  });
});

describe("export query", () => {
  it("parses from and to parameters", () => {
    const url = new URL(
      "http://example.com/api/responses?from=2026-08-01T00:00:00.000Z&to=2026-08-31T23:59:59.000Z",
    );
    expect(parseExportQuery(url)).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-31T23:59:59.000Z",
    });
  });

  it("rejects invalid timestamps", () => {
    const url = new URL("http://example.com/api/responses?from=not-a-date");
    expect(parseExportQuery(url)).toEqual({ error: "Invalid from parameter" });
  });
});

describe("export serialization", () => {
  it("serializes a pandas-friendly JSON array", () => {
    const json = serializeResponses([
      {
        id: "response-1",
        prompt_id: "prompt-1",
        feeling: "good",
        intensity: 7,
        note: null,
        confidence: null,
        vocab_era: null,
        observed_at: "2026-08-13T10:00:00.000Z",
        submitted_at: "2026-08-13T10:01:00.000Z",
      },
    ]);

    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].feeling).toBe("good");
  });

  it("carries note and confidence when set", () => {
    const json = serializeResponses([
      {
        id: "response-2",
        prompt_id: "prompt-2",
        feeling: "irritated",
        intensity: 5,
        note: "before the meeting",
        confidence: "strong",
        vocab_era: "E5",
        observed_at: "2026-08-13T10:00:00.000Z",
        submitted_at: "2026-08-13T10:01:00.000Z",
      },
    ]);

    const parsed = JSON.parse(json);
    expect(parsed[0].note).toBe("before the meeting");
    expect(parsed[0].confidence).toBe("strong");
    expect(parsed[0].vocab_era).toBe("E5");
  });

  it("serializes note and confidence as null when unset", () => {
    const json = serializeResponses([
      {
        id: "response-3",
        prompt_id: "prompt-3",
        feeling: "anxious: before the meeting",
        intensity: 4,
        note: null,
        confidence: null,
        vocab_era: null,
        observed_at: "2026-08-13T10:00:00.000Z",
        submitted_at: "2026-08-13T10:01:00.000Z",
      },
    ]);

    const parsed = JSON.parse(json);
    expect(parsed[0].note).toBeNull();
    expect(parsed[0].confidence).toBeNull();
    expect(parsed[0].vocab_era).toBeNull();
    expect(parsed[0].feeling).toBe("anxious: before the meeting");
  });
});
