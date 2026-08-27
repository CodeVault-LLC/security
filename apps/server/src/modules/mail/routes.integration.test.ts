import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomBytes } from "node:crypto";

import type {
  CaseDetail,
  GmailThreadPreview,
  MailThreadDetail,
  MailThreadPage,
  MailTrackingTargets,
  MailboxConnection,
  SubmissionDetail,
  VendorDetail,
  VendorRoute,
} from "@codevault/contracts";
import { uuidv7 } from "@codevault/core/crypto";

import type { MailProvider } from "./provider.js";
import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("Gmail connection routes", () => {
  let harness: TestHarness;
  let connectedUser: TestUser;
  let connectedMailbox: MailboxConnection;

  beforeAll(async () => {
    harness = await createHarness();
    const externalAccountId = crypto.randomUUID();
    harness.config.gmail = {
      enabled: true,
      clientId: "test-client",
      clientSecret: "test-secret",
      redirectUri: "https://codevault.test/v1/mail/gmail/callback",
      tokenKeyring: { activeVersion: 1, keys: new Map([[1, randomBytes(32)]]) },
      endpoints: null,
      pubsub: null,
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
      async findByRfcMessageId() {
        return null;
      },
      async getHistory() {
        return { historyId: "1", messageIds: [], nextPageToken: null };
      },
      async searchSentMessages() {
        return [
          {
            providerMessageId: "sent-1",
            providerThreadId: "thread-existing",
          },
        ];
      },
      async listMessages() {
        return {
          messages: [
            {
              providerMessageId: "sent-1",
              providerThreadId: "thread-existing",
            },
          ],
          nextPageToken: null,
        };
      },
      async getMessageMetadata(_accessToken, messageId) {
        const outbound = messageId === "sent-1";
        return {
          id: messageId,
          threadId: "thread-existing",
          labelIds: outbound ? ["SENT"] : ["INBOX"],
          headers: [
            {
              name: "From",
              value: outbound
                ? "Researcher <researcher@example.test>"
                : "Vendor <security@vendor.test>",
            },
            {
              name: "To",
              value: outbound
                ? "Vendor <security@vendor.test>"
                : "Researcher <researcher@example.test>",
            },
            { name: "Subject", value: "Existing disclosure" },
            { name: "Date", value: "Wed, 26 Aug 2026 10:00:00 +0000" },
          ],
        };
      },
      async getMessageRaw(_accessToken, messageId) {
        const outbound = messageId === "sent-1";
        return new TextEncoder().encode(
          [
            `From: ${outbound ? "researcher@example.test" : "security@vendor.test"}`,
            `To: ${outbound ? "security@vendor.test" : "researcher@example.test"}`,
            "Subject: Existing disclosure",
            `Message-ID: <${messageId}@example.test>`,
            "Date: Wed, 26 Aug 2026 10:00:00 +0000",
            "Content-Type: text/plain; charset=utf-8",
            "",
            outbound ? "Initial report" : "Thank you for the report",
          ].join("\r\n"),
        );
      },
      async getProfileHistoryId() {
        return "1";
      },
      async getThreadMessageIds(_accessToken, threadId) {
        return threadId === "thread-existing" ? ["sent-1", "reply-1"] : [];
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

    connectedUser = await harness.createUser();
    const started = await harness.app.inject({
      method: "POST",
      url: "/v1/mail/gmail/connect",
      headers: connectedUser.headers,
      payload: { enableReplyTracking: true },
    });
    const state = new URL(
      started.json<{ authorizationUrl: string }>().authorizationUrl,
    ).searchParams.get("state");
    const completed = await harness.app.inject({
      method: "GET",
      url: `/v1/mail/gmail/callback?code=setup-code&state=${state}`,
    });
    expect(completed.statusCode, completed.body).toBe(200);
    const listed = await harness.app.inject({
      method: "GET",
      url: "/v1/mail/connections",
      headers: connectedUser.headers,
    });
    connectedMailbox = listed.json<{ items: MailboxConnection[] }>().items[0]!;
  });

  afterAll(async () => harness.close());

  test("consumes encrypted OAuth state exactly once and never returns tokens", async () => {
    const user = connectedUser;
    const started = await harness.app.inject({
      method: "POST",
      url: "/v1/mail/gmail/connect",
      headers: user.headers,
      payload: { enableReplyTracking: true },
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
    connectedMailbox = listed.json<{ items: MailboxConnection[] }>().items[0]!;
  });

  test("previews and links one existing Gmail thread to a draft submission", async () => {
    const user = connectedUser;
    const connection = connectedMailbox;

    const caseResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: {
        title: `Existing Gmail thread ${uuidv7()}`,
        profile: "COORDINATED_DISCLOSURE",
      },
    });
    const researchCase = caseResponse.json<CaseDetail>();
    const vendorResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/vendors",
      headers: user.headers,
      payload: { name: `Gmail Vendor ${uuidv7()}` },
    });
    const vendor = vendorResponse.json<VendorDetail>();
    const routeResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/routes`,
      headers: user.headers,
      payload: {
        name: "Vendor security",
        type: "EMAIL",
        to: ["security@vendor.test"],
        cc: [],
        subjectTemplate: "Security report",
        maximumAttachmentBytes: 20_000_000,
        acknowledgementBusinessDays: 5,
        updateCadenceDays: 30,
        requiredFields: [],
        encryptionPolicy: "OPTIONAL",
        publicKeyId: null,
      },
    });
    const route = routeResponse.json<VendorRoute>();
    const created = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${researchCase.id}/submissions`,
      headers: user.headers,
      payload: { vendorId: vendor.id, routeId: route.id, cryptoMode: "PLAIN" },
    });
    const submission = created.json<SubmissionDetail>();

    const searchResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/submissions/${submission.id}/gmail-thread/search`,
      headers: user.headers,
      payload: {
        mailboxConnectionId: connection.id,
        query: "security@vendor.test",
      },
    });
    expect(searchResponse.statusCode, searchResponse.body).toBe(200);
    expect(searchResponse.json()).toEqual({
      items: [
        {
          providerThreadId: "thread-existing",
          subject: "Existing disclosure",
          to: ["security@vendor.test"],
          occurredAt: "2026-08-26T10:00:00.000Z",
        },
      ],
    });

    const inboxResponse = await harness.app.inject({
      method: "GET",
      url: `/v1/mail/connections/${connection.id}/threads?folder=INBOX`,
      headers: user.headers,
    });
    expect(inboxResponse.statusCode, inboxResponse.body).toBe(200);
    expect(inboxResponse.json<MailThreadPage>()).toMatchObject({
      items: [
        {
          providerThreadId: "thread-existing",
          subject: "Existing disclosure",
          tracking: null,
        },
      ],
      nextPageToken: null,
    });

    const threadResponse = await harness.app.inject({
      method: "GET",
      url: `/v1/mail/connections/${connection.id}/threads/thread-existing`,
      headers: user.headers,
    });
    expect(threadResponse.statusCode, threadResponse.body).toBe(200);
    expect(threadResponse.json<MailThreadDetail>()).toMatchObject({
      providerThreadId: "thread-existing",
      tooLarge: false,
      tracking: null,
      messages: [
        { direction: "OUTBOUND", bodyText: "Initial report" },
        { direction: "INBOUND", bodyText: "Thank you for the report" },
      ],
    });

    const trackingPreviewResponse = await harness.app.inject({
      method: "GET",
      url: `/v1/mail/connections/${connection.id}/threads/thread-existing/tracking-preview?submissionId=${submission.id}`,
      headers: user.headers,
    });
    expect(
      trackingPreviewResponse.statusCode,
      trackingPreviewResponse.body,
    ).toBe(200);
    expect(trackingPreviewResponse.json<GmailThreadPreview>()).toMatchObject({
      providerThreadId: "thread-existing",
      warnings: [],
    });

    const targetsResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/mail/tracking-targets",
      headers: user.headers,
    });
    expect(targetsResponse.statusCode, targetsResponse.body).toBe(200);
    expect(
      targetsResponse
        .json<MailTrackingTargets>()
        .items.some((target) => target.submissionId === submission.id),
    ).toBe(true);

    const previewResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/submissions/${submission.id}/gmail-thread/preview`,
      headers: user.headers,
      payload: {
        mailboxConnectionId: connection.id,
        threadReference: "thread-existing",
      },
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    expect(previewResponse.json<GmailThreadPreview>()).toMatchObject({
      providerThreadId: "thread-existing",
      subject: "Existing disclosure",
      warnings: [],
      messages: [
        { providerMessageId: "sent-1", direction: "OUTBOUND" },
        { providerMessageId: "reply-1", direction: "INBOUND" },
      ],
    });

    const linkedResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/submissions/${submission.id}/gmail-thread/link`,
      headers: user.headers,
      payload: {
        mailboxConnectionId: connection.id,
        threadReference: "thread-existing",
        expectedRevision: submission.revision,
      },
    });
    expect(linkedResponse.statusCode, linkedResponse.body).toBe(200);
    expect(linkedResponse.json<SubmissionDetail>()).toMatchObject({
      status: "SENT",
      coordinationState: "AWAITING_ACKNOWLEDGEMENT",
      subject: "Existing disclosure",
    });
    expect(harness.jobs.sent).toContainEqual({
      queue: "gmail-sync",
      data: { connectionId: connection.id, threadId: "thread-existing" },
    });
  });
});
