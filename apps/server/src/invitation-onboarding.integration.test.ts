import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateOpaqueToken } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import { hashToken } from "./auth/tokens.js";
import { generateTotpAt } from "./auth/totp.js";
import {
  createHarness,
  TEST_PASSWORD,
  type TestHarness,
  type TestUser,
} from "./testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("invitation MFA onboarding", () => {
  let harness: TestHarness;
  let admin: TestUser;

  beforeAll(async () => {
    harness = await createHarness();
    admin = await harness.createUser({ role: "ADMIN" });
  });

  afterAll(async () => {
    await harness.close();
  });

  async function invite(email: string): Promise<string> {
    const token = generateOpaqueToken();
    await harness.dbHandle.db.insert(schema.invites).values({
      organizationId: harness.organizationId,
      email,
      role: "MEMBER",
      tokenHash: hashToken(token),
      createdBy: admin.id,
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    return token;
  }

  it("creates no account until TOTP confirmation and returns codes once", async () => {
    const email = `onboard-${Date.now()}@codevault.test`;
    const token = await invite(email);
    const inspection = await harness.app.inject({
      method: "POST",
      url: "/v1/invitations/inspect",
      payload: { token },
    });
    expect(inspection.statusCode).toBe(200);
    expect(inspection.json<{ email: string }>().email).toBe(email);

    const start = await harness.app.inject({
      method: "POST",
      url: "/v1/invitations/enrollment/start",
      payload: {
        token,
        displayName: "Invited Researcher",
        password: TEST_PASSWORD,
      },
    });
    expect(start.statusCode).toBe(200);
    const enrollment = start.json<{
      enrollmentToken: string;
      manualSecret: string;
    }>();
    expect(await userCount(email)).toBe(0);

    const invalid = await harness.app.inject({
      method: "POST",
      url: "/v1/invitations/enrollment/confirm",
      payload: { enrollmentToken: enrollment.enrollmentToken, totp: "000000" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(await userCount(email)).toBe(0);

    const confirmed = await harness.app.inject({
      method: "POST",
      url: "/v1/invitations/enrollment/confirm",
      payload: {
        enrollmentToken: enrollment.enrollmentToken,
        totp: generateTotpAt(enrollment.manualSecret, Date.now()),
      },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(
      confirmed.json<{ recoveryCodes: string[] }>().recoveryCodes,
    ).toHaveLength(10);
    expect(await userCount(email)).toBe(1);

    const replay = await harness.app.inject({
      method: "POST",
      url: "/v1/invitations/enrollment/confirm",
      payload: {
        enrollmentToken: enrollment.enrollmentToken,
        totp: generateTotpAt(enrollment.manualSecret, Date.now()),
      },
    });
    expect(replay.statusCode).toBe(400);
  });

  async function userCount(email: string): Promise<number> {
    const [row] = await harness.dbHandle.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return row?.count ?? 0;
  }
});
