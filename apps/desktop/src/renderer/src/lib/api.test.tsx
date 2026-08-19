import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "./api.js";
import { useSession } from "./session.js";

const apiBridge = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("./bridge.js", () => ({
  bridge: () => ({ api: apiBridge }),
}));

const user = {
  id: "018f03d2-b7fd-7aef-8ac4-24b921aa6723",
  email: "researcher@example.test",
  displayName: "Researcher",
  role: "MEMBER" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastLoginAt: null,
};

describe("apiRequest authentication failures", () => {
  beforeEach(() => {
    apiBridge.request.mockReset();
    useSession.getState().signIn(user, null);
  });

  it("signs out as soon as the server reports an expired session", async () => {
    apiBridge.request.mockResolvedValue({
      ok: false,
      category: "SESSION_EXPIRED",
      message: "Your session has expired. Sign in again.",
      requestId: "request-1",
      details: null,
    });

    await expect(apiRequest("/v1/dashboard")).rejects.toMatchObject({
      category: "SESSION_EXPIRED",
    });
    expect(useSession.getState().status).toBe("SIGNED_OUT");
  });

  it("does not sign out for an ordinary authorization failure", async () => {
    apiBridge.request.mockResolvedValue({
      ok: false,
      category: "PERMISSION_DENIED",
      message: "You do not have access to this resource.",
      requestId: "request-2",
      details: null,
    });

    await expect(apiRequest("/v1/admin-only")).rejects.toMatchObject({
      category: "PERMISSION_DENIED",
    });
    expect(useSession.getState().status).toBe("SIGNED_IN");
  });
});
