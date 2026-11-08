import { describe, it, expect, vi, afterEach } from "vitest";
import { api, setToken, deadline } from "./api";
afterEach(() => vi.unstubAllGlobals());
describe("staff API client", () => {
  it("uses in-memory bearer and idempotency key", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    setToken("test-token");
    await api("/api/tickets", "POST", { title: "test" }, "command-123");
    expect(fetch.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
      "Idempotency-Key": "command-123",
    });
  });
  it("surfaces API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          json: async () => ({ detail: "stale version" }),
        }),
    );
    await expect(api("/api/tickets")).rejects.toThrow("stale version");
  });
  it("keeps historical SLA result after completion", () => {
    expect(deadline(1000, 900)).toBe("ทัน SLA");
    expect(deadline(1000, 1100)).toBe("เกิน SLA");
  });
});
