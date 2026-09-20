import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";

const originalFetch = globalThis.fetch;

function mockResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the parsed body on success", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse({ count: 3, sites: [] }));
    await expect(api.sites()).resolves.toEqual({ count: 3, sites: [] });
  });

  it("surfaces the server's own message on a structured error", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockResponse(
        { error: { code: "artifact_unavailable", message: "The heat model has not been trained yet.", detail: { task: "heat" } } },
        503,
      ),
    );

    await expect(api.sites()).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      code: "artifact_unavailable",
      message: "The heat model has not been trained yet.",
    });
  });

  it("explains how to start the service when the network is unreachable", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError("fetch failed"));

    const error: unknown = await api.meta().then(() => null, (exc) => exc);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(0);
    expect(apiError.code).toBe("network_unreachable");
    expect(apiError.message).toMatch(/uvicorn/i);
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    );
    await expect(api.meta()).rejects.toMatchObject({ status: 502 });
  });

  it("posts JSON with the right content type", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse({ ok: true }));
    await api.predictHeat({ station_id: "725053-94728" });

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ station_id: "725053-94728" }));
  });

  it("never invents a value when a request fails", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError("fetch failed"));
    // The contract is that the client throws rather than resolving to a default.
    await expect(api.hotspotsBaseline()).rejects.toBeInstanceOf(ApiError);
  });
});
