import type {
  MailHistoryPage,
  MailIdentity,
  MailProvider,
  OAuthTokens,
  ProviderMessageMetadata,
  SendAsAddress,
  SentMessage,
} from "./provider.js";

interface GmailProviderConfig {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function base64UrlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Gmail returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

export function createGmailProvider(config: GmailProviderConfig): MailProvider {
  const requestFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;

  async function request(
    url: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const response = await requestFetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Gmail request failed with status ${response.status}.`);
    }
    return asObject(await response.json());
  }

  async function authenticated(
    accessToken: string,
    url: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${accessToken}`);
    return request(url, {
      ...init,
      headers,
    });
  }

  async function tokenRequest(body: URLSearchParams): Promise<OAuthTokens> {
    const data = await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (typeof data.access_token !== "string")
      throw new Error("Google did not return an access token.");
    return {
      accessToken: data.access_token,
      refreshToken:
        typeof data.refresh_token === "string" ? data.refresh_token : null,
      expiresInSeconds:
        typeof data.expires_in === "number" ? data.expires_in : 3_600,
      grantedScopes:
        typeof data.scope === "string"
          ? data.scope.split(" ").filter(Boolean)
          : [],
    };
  }

  return {
    id: "gmail",

    exchangeAuthorizationCode(code, verifier, redirectUri) {
      return tokenRequest(
        new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          code_verifier: verifier,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      );
    },

    refreshAccessToken(refreshToken) {
      return tokenRequest(
        new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      );
    },

    async getIdentity(accessToken): Promise<MailIdentity> {
      const data = await authenticated(
        accessToken,
        "https://openidconnect.googleapis.com/v1/userinfo",
      );
      if (
        typeof data.sub !== "string" ||
        typeof data.email !== "string" ||
        data.email.includes("\r") ||
        data.email.includes("\n")
      ) {
        throw new Error("Google did not return a safe mailbox identity.");
      }
      if (data.email_verified !== true)
        throw new Error("The Google mailbox email is not verified.");
      return {
        externalAccountId: data.sub,
        emailAddress: data.email.toLowerCase(),
      };
    },

    async listSendAs(accessToken): Promise<SendAsAddress[]> {
      const data = await authenticated(
        accessToken,
        "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
      );
      const entries = Array.isArray(data.sendAs) ? data.sendAs : [];
      return entries.flatMap((value) => {
        const row = asObject(value);
        if (
          typeof row.sendAsEmail !== "string" ||
          /[\r\n]/.test(row.sendAsEmail)
        )
          return [];
        return [
          {
            emailAddress: row.sendAsEmail.toLowerCase(),
            primary: row.isPrimary === true,
            verified:
              row.isPrimary === true || row.verificationStatus === "accepted",
          },
        ];
      });
    },

    async send(accessToken, rawMessage, threadId): Promise<SentMessage> {
      const data = await authenticated(
        accessToken,
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            raw: Buffer.from(rawMessage).toString("base64url"),
            ...(threadId === undefined ? {} : { threadId }),
          }),
        },
      );
      if (typeof data.id !== "string" || typeof data.threadId !== "string")
        throw new Error("Gmail did not confirm a message ID.");
      return { providerMessageId: data.id, providerThreadId: data.threadId };
    },

    async getHistory(
      accessToken,
      startHistoryId,
      pageToken,
    ): Promise<MailHistoryPage> {
      const url = new URL(
        "https://gmail.googleapis.com/gmail/v1/users/me/history",
      );
      url.searchParams.set("startHistoryId", startHistoryId);
      url.searchParams.set("historyTypes", "messageAdded");
      if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);
      const data = await authenticated(accessToken, url.toString());
      const ids = new Set<string>();
      for (const history of Array.isArray(data.history) ? data.history : []) {
        const row = asObject(history);
        for (const added of Array.isArray(row.messagesAdded)
          ? row.messagesAdded
          : []) {
          const message = asObject(asObject(added).message);
          if (typeof message.id === "string") ids.add(message.id);
        }
      }
      if (typeof data.historyId !== "string")
        throw new Error("Gmail omitted the history cursor.");
      return {
        historyId: data.historyId,
        messageIds: [...ids],
        nextPageToken:
          typeof data.nextPageToken === "string" ? data.nextPageToken : null,
      };
    },

    async getMessageMetadata(
      accessToken,
      messageId,
    ): Promise<ProviderMessageMetadata> {
      const url = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
      );
      url.searchParams.set("format", "metadata");
      const data = await authenticated(accessToken, url.toString());
      const payload = asObject(data.payload);
      const headers = (
        Array.isArray(payload.headers) ? payload.headers : []
      ).flatMap((value) => {
        const header = asObject(value);
        return typeof header.name === "string" &&
          typeof header.value === "string"
          ? [{ name: header.name, value: header.value }]
          : [];
      });
      if (typeof data.id !== "string" || typeof data.threadId !== "string")
        throw new Error("Gmail returned invalid message metadata.");
      return {
        id: data.id,
        threadId: data.threadId,
        labelIds: Array.isArray(data.labelIds)
          ? data.labelIds.filter((v): v is string => typeof v === "string")
          : [],
        headers,
      };
    },

    async getMessageRaw(accessToken, messageId): Promise<Uint8Array> {
      const url = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
      );
      url.searchParams.set("format", "raw");
      const data = await authenticated(accessToken, url.toString());
      if (typeof data.raw !== "string")
        throw new Error("Gmail omitted the raw message.");
      return base64UrlDecode(data.raw);
    },

    async startWatch(accessToken, topicName) {
      const data = await authenticated(
        accessToken,
        "https://gmail.googleapis.com/gmail/v1/users/me/watch",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topicName }),
        },
      );
      if (
        typeof data.historyId !== "string" ||
        typeof data.expiration !== "string"
      )
        throw new Error("Gmail returned an invalid watch.");
      return {
        historyId: data.historyId,
        expiresAt: new Date(Number(data.expiration)).toISOString(),
      };
    },

    async stopWatch(accessToken) {
      await authenticated(
        accessToken,
        "https://gmail.googleapis.com/gmail/v1/users/me/stop",
        { method: "POST" },
      );
    },

    async revoke(refreshToken) {
      const response = await requestFetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (!response.ok)
        throw new Error(
          `Google token revocation failed with status ${response.status}.`,
        );
    },
  };
}
