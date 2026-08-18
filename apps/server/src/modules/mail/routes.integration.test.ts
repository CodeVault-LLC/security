import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomBytes } from "node:crypto";

import type { MailProvider } from "./provider.js";
import { createHarness, type TestHarness } from "../../testing/harness.js";

describe("Gmail connection routes", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createHarness();
    const externalAccountId = crypto.randomUUID();
    harness.config.gmail = {
      enabled: true,
      clientId: "test-client",
      clientSecret: "test-secret",
      redirectUri: "https://codevault.test/v1/mail/gmail/callback",
      tokenKeyring: { activeVersion: 1, keys: new Map([[1, randomBytes(32)]]) },
    };
    harness.app.mailProviders.register({
      id: "gmail",
      async exchangeAuthorizationCode() {
        return {
          accessToken: "memory-access",
          refreshToken: "memory-refresh",
          expiresInSeconds: 3600,
          grantedScopes: [
            "openid",
            "email",
            "https://www.googleapis.com/auth/gmail.send",
          ],
        };
      },
      async refreshAccessToken() {
        return {
          accessToken: "memory-access",
          refreshToken: null,
          expiresInSeconds: 3600,
          grantedScopes: [],
        };
      },
      async getIdentity() {
        return {
          externalAccountId,
          emailAddress: "researcher@example.test",
        };
      },
      async listSendAs() {
        return [
          {
            emailAddress: "researcher@example.test",
            primary: true,
            verified: true,
          },
        ];
      },
      async send() {
        return { providerMessageId: "m1", providerThreadId: "t1" };
      },
      async getHistory() {
        return { historyId: "1", messageIds: [], nextPageToken: null };
      },
      async getMessageMetadata() {
        return { id: "m1", threadId: "t1", labelIds: [], headers: [] };
      },
      async getMessageRaw() {
        return new Uint8Array();
      },
      async startWatch() {
        return {
          historyId: "1",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        };
      },
      async stopWatch() {},
      async revoke() {},
    } satisfies MailProvider);
  });

  afterAll(async () => harness.close());

  test("consumes encrypted OAuth state exactly once and never returns tokens", async () => {
    const user = await harness.createUser();
    const started = await harness.app.inject({
      method: "POST",
      url: "/v1/mail/gmail/connect",
      headers: user.headers,
      payload: { enableReplyTracking: false },
    });
    expect(started.statusCode).toBe(200);
    const authorization = started.json<{ authorizationUrl: string }>();
    const state = new URL(authorization.authorizationUrl).searchParams.get(
      "state",
    );
    expect(state).not.toBeNull();

    const completed = await harness.app.inject({
      method: "GET",
      url: `/v1/mail/gmail/callback?code=test-code&state=${state}`,
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.body).not.toContain("memory-refresh");
    expect(completed.body).not.toContain("memory-access");

    const reused = await harness.app.inject({
      method: "GET",
      url: `/v1/mail/gmail/callback?code=test-code&state=${state}`,
    });
    expect(reused.statusCode).toBe(400);

    const listed = await harness.app.inject({
      method: "GET",
      url: "/v1/mail/connections",
      headers: user.headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).toContain("researcher@example.test");
    expect(listed.body).not.toContain("memory-refresh");
  });
});
