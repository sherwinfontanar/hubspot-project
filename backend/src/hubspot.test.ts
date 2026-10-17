
import { afterEach, describe, expect, it, vi } from "vitest";
import { hubspotRequest } from "./hubspot.js";

describe("HubSpot request retry behavior", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("retries HTTP 429 and honors Retry-After", async () => {
    vi.useFakeTimers();
    vi.stubEnv("HUBSPOT_ACCESS_TOKEN", "test-token");

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("Rate limited", {
          status: 429,
          headers: { "Retry-After": "1" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = hubspotRequest<{ success: boolean }>("/test");

    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries HTTP 500 and succeeds on the next attempt", async () => {
    vi.useFakeTimers();
    vi.stubEnv("HUBSPOT_ACCESS_TOKEN", "test-token");

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Server error", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = hubspotRequest<{ success: boolean }>("/test");

    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  
it("stops after four attempts when HTTP 503 persists", async () => {
  vi.useFakeTimers();
  vi.stubEnv("HUBSPOT_ACCESS_TOKEN", "test-token");

  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
    // Return a fresh response for every retry attempt.
    return new Response("Service unavailable", { status: 503 });
  });

  vi.stubGlobal("fetch", fetchMock);

  const resultPromise = hubspotRequest("/test");
  const assertion = expect(resultPromise).rejects.toThrow(
    "HubSpot returned HTTP 503",
  );

  await vi.runAllTimersAsync();
  await assertion;

  expect(fetchMock).toHaveBeenCalledTimes(4);
});


  it("does not retry a non-retryable HTTP 400", async () => {
    vi.stubEnv("HUBSPOT_ACCESS_TOKEN", "test-token");

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("Bad request", { status: 400 }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(hubspotRequest("/test")).rejects.toThrow(
      "HubSpot returned HTTP 400",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
