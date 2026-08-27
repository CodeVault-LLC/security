import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  LoginStartResponse,
  OrganizationSecurityPolicy,
  UpdateOrganizationSecurityPolicy,
} from "./index.js";

FormatRegistry.Set("uuid", (value) => /^[0-9a-f-]{36}$/iu.test(value));
FormatRegistry.Set("date-time", (value) => Number.isFinite(Date.parse(value)));
FormatRegistry.Set("email", (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value),
);

describe("configurable organization authentication", () => {
  it("accepts disabling MFA in organization security policy contracts", () => {
    expect(
      Value.Check(UpdateOrganizationSecurityPolicy, { mfaRequired: false }),
    ).toBe(true);
    expect(
      Value.Check(OrganizationSecurityPolicy, {
        mfaRequired: false,
        inviteTtlHours: 72,
        sessionIdleMinutes: 30,
        sessionAbsoluteHours: 12,
        recentMfaMinutes: 10,
        mcpEnabled: true,
        mailHtmlRenderingEnabled: true,
        updatedAt: "2026-08-25T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("accepts a password-authenticated login result when MFA is optional", () => {
    expect(
      Value.Check(LoginStartResponse, {
        token: "x".repeat(32),
        expiresAt: "2026-08-25T01:00:00.000Z",
        user: {
          id: "018f2f56-7c9a-7abc-8def-0123456789ab",
          email: "admin@example.test",
          displayName: "Admin",
          role: "ADMIN",
          createdAt: "2026-08-25T00:00:00.000Z",
          lastLoginAt: null,
        },
      }),
    ).toBe(true);
  });
});
