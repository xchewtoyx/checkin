import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("checkin worker", () => {
  it("returns ok from /health", async () => {
    const response = await SELF.fetch("http://example.com/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns 404 for unknown routes", async () => {
    const response = await SELF.fetch("http://example.com/unknown");

    expect(response.status).toBe(404);
  });
});
