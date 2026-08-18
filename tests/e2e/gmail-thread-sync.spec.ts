import { expect, test } from "playwright/test";

import { createGmailProvider } from "../../apps/server/src/modules/mail/gmail-provider.js";
import { syncMailboxHistory } from "../../apps/worker/src/jobs/gmail-sync.js";
import { FakeGmail } from "./fixtures/fake-gmail.js";

test.describe("fake Gmail delivery and tracked-thread sync", () => {
  let fake: FakeGmail;

  test.beforeEach(async () => {
    fake = new FakeGmail();
    await fake.start();
  });

  test.afterEach(async () => {
    await fake.close();
  });

  test("sends deterministically and fetches raw content only for tracked threads", async () => {
    const provider = createGmailProvider({
      clientId: "e2e-client",
      clientSecret: "e2e-secret",
      endpoints: fake.endpoints(),
      timeoutMs: 1_000,
    });
    const tokens = await provider.exchangeAuthorizationCode(
      "fake-authorization-code",
      "pkce-verifier",
      "http://127.0.0.1/callback",
    );
    expect(await provider.getIdentity(tokens.accessToken)).toEqual({
      externalAccountId: "fake-google-account-1",
      emailAddress: "researcher@codevault.test",
    });

    const raw = new TextEncoder().encode(
      [
        "From: researcher@codevault.test",
        "To: psirt@example.test",
        "Subject: [UNENCRYPTED SUBJECT] Confidential report",
        "Message-ID: <stable-package@codevault.test>",
        "",
        "sealed package",
      ].join("\r\n"),
    );
    const sent = await provider.send(tokens.accessToken, raw);
    expect(
      await provider.findByRfcMessageId(
        tokens.accessToken,
        "<stable-package@codevault.test>",
      ),
    ).toEqual(sent);

    const unrelated = fake.deliverReply({
      threadId: "unrelated-thread",
      text: "unrelated mailbox message",
    });
    const reply = fake.deliverReply({
      threadId: sent.providerThreadId,
      text: "Received; case TP-123",
    });
    const persisted: string[] = [];
    let cursor = "100";
    await syncMailboxHistory({
      accessToken: tokens.accessToken,
      startHistoryId: cursor,
      getHistory: (...args) => provider.getHistory(...args),
      getMessageMetadata: (...args) => provider.getMessageMetadata(...args),
      isTrackedThread: async (threadId) => threadId === sent.providerThreadId,
      getMessageRaw: (...args) => provider.getMessageRaw(...args),
      persistTracked: async ({ metadata }) => {
        persisted.push(metadata.id);
      },
      advanceCursor: async (historyId) => {
        cursor = historyId;
      },
    });

    expect(cursor).not.toBe("100");
    expect(persisted).toContain(reply.id);
    expect(fake.metadataFetches).toContain(unrelated.id);
    expect(fake.rawFetches).toContain(reply.id);
    expect(fake.rawFetches).not.toContain(unrelated.id);
  });

  test("models cursor expiry, duplicate push, timeout, and revocation safely", async () => {
    const provider = createGmailProvider({
      clientId: "e2e-client",
      clientSecret: "e2e-secret",
      endpoints: fake.endpoints(),
      timeoutMs: 50,
    });
    const firstPush = fake.pubsubEnvelope();
    expect(fake.pubsubEnvelope(true)).toEqual(firstPush);

    fake.expireHistoryCursor();
    await expect(
      provider.getHistory("fake-access-token", "1"),
    ).rejects.toMatchObject({
      status: 404,
    });

    fake.timeoutNext("/messages/send");
    await expect(
      provider.send(
        "fake-access-token",
        new TextEncoder().encode(
          "From: researcher@codevault.test\r\nMessage-ID: <timeout@test>\r\n\r\nbody",
        ),
      ),
    ).rejects.toThrow();

    await provider.revoke("fake-refresh-token");
    await expect(
      provider.refreshAccessToken("fake-refresh-token"),
    ).rejects.toMatchObject({
      status: 401,
    });
  });
});
