import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schema } from "@codevault/db";

import { hashToken } from "./auth/tokens.js";
import {
  clearLoginAttempts,
  createHarness,
  TEST_PASSWORD,
  type TestHarness,
} from "./testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("WebAuthn security keys", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("serves the ceremony from the relying-party origin with a closed CSP", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/auth/webauthn/ceremony",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(response.body).toContain("navigator.credentials");
  });

  it("creates one-time hardware-key registration options for a recent session", async () => {
    const user = await harness.createUser();
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/settings/security-keys/options",
      headers: user.headers,
      payload: { name: "Primary YubiKey" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      ceremonyToken: string;
      options: {
        rp: { id: string };
        authenticatorSelection: { authenticatorAttachment: string };
      };
    }>();
    expect(body.options.rp.id).toBe("localhost");
    expect(body.options.authenticatorSelection.authenticatorAttachment).toBe(
      "cross-platform",
    );
    const stored = await harness.dbHandle.db
      .select({ tokenHash: schema.webauthnCeremonies.tokenHash })
      .from(schema.webauthnCeremonies)
      .where(
        eq(schema.webauthnCeremonies.tokenHash, hashToken(body.ceremonyToken)),
      );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toBe(body.ceremonyToken);
  });

  it("advertises and scopes WebAuthn login to registered credentials", async () => {
    const user = await harness.createUser();
    const credentialId = `registered-${user.id}`;
    await harness.dbHandle.db.insert(schema.webauthnCredentials).values({
      userId: user.id,
      credentialId,
      publicKey: "unused-in-options-test",
      transports: ["usb"],
      deviceType: "singleDevice",
      backedUp: false,
      name: "Test YubiKey",
    });
    await clearLoginAttempts(harness);
    const started = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login/start",
      payload: { email: user.email, password: TEST_PASSWORD },
    });
    expect(started.statusCode).toBe(200);
    const login = started.json<{
      challengeToken: string;
      methods: string[];
    }>();
    expect(login.methods).toEqual(["TOTP", "WEBAUTHN"]);

    const options = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/webauthn/login/options",
      payload: { challengeToken: login.challengeToken },
    });
    expect(options.statusCode).toBe(200);
    expect(
      options.json<{
        options: { allowCredentials: Array<{ id: string }> };
      }>().options.allowCredentials,
    ).toEqual([expect.objectContaining({ id: credentialId })]);
  });

  it("does not reveal whether a login challenge or credential was invalid", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/webauthn/login/options",
      payload: { challengeToken: "x".repeat(32) },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { message: string } }>().error.message).toBe(
      "The security key was not accepted.",
    );
  });

  it("lists and revokes only the current user's security keys", async () => {
    const user = await harness.createUser();
    const [credential] = await harness.dbHandle.db
      .insert(schema.webauthnCredentials)
      .values({
        userId: user.id,
        credentialId: `revocable-${user.id}`,
        publicKey: "unused-in-lifecycle-test",
        transports: ["usb"],
        deviceType: "singleDevice",
        backedUp: false,
        name: "Spare YubiKey",
      })
      .returning({ id: schema.webauthnCredentials.id });
    const listed = await harness.app.inject({
      method: "GET",
      url: "/v1/settings/security-keys",
      headers: user.headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(
      listed.json<{ items: Array<{ id: string; name: string }> }>().items,
    ).toContainEqual(
      expect.objectContaining({ id: credential!.id, name: "Spare YubiKey" }),
    );

    const revoked = await harness.app.inject({
      method: "DELETE",
      url: `/v1/settings/security-keys/${credential!.id}`,
      headers: user.headers,
    });
    expect(revoked.statusCode).toBe(200);
    const after = await harness.app.inject({
      method: "GET",
      url: "/v1/settings/security-keys",
      headers: user.headers,
    });
    expect(
      after
        .json<{ items: Array<{ id: string }> }>()
        .items.some((item) => item.id === credential!.id),
    ).toBe(false);
  });
});
