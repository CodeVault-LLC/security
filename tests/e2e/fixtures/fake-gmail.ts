import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeGmailMessage {
  id: string;
  threadId: string;
  raw: Uint8Array;
  labelIds: string[];
  headers: Array<{ name: string; value: string }>;
}

interface DeliveredReply {
  threadId: string;
  subject?: string;
  text: string;
  from?: string;
  to?: string;
}

/**
 * Deterministic, loopback-only Gmail test double.
 *
 * It intentionally implements only the calls CodeVault is allowed to make.
 * Every raw-body read is recorded so privacy minimization can be asserted.
 */
export class FakeGmail {
  readonly rawFetches: string[] = [];
  readonly metadataFetches: string[] = [];
  readonly sentMessages: FakeGmailMessage[] = [];

  #server = createServer((request, response) => {
    void this.#handle(request, response).catch((error: unknown) => {
      response.statusCode = 500;
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  });
  #messages = new Map<string, FakeGmailMessage>();
  #history: string[] = [];
  #historyId = 100;
  #nextMessageId = 1;
  #expiredHistory = false;
  #revoked = false;
  #timeoutPath: string | null = null;
  #lastPush: { message: { data: string; messageId: string } } | null = null;

  baseUrl = "";

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.#server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
  }

  endpoints() {
    return {
      token: `${this.baseUrl}/token`,
      revoke: `${this.baseUrl}/revoke`,
      userInfo: `${this.baseUrl}/userinfo`,
      gmailApi: `${this.baseUrl}/gmail/v1`,
    };
  }

  expireHistoryCursor(): void {
    this.#expiredHistory = true;
  }

  timeoutNext(pathFragment: string): void {
    this.#timeoutPath = pathFragment;
  }

  revokeTokens(): void {
    this.#revoked = true;
  }

  deliverReply(input: DeliveredReply): FakeGmailMessage {
    const id = `inbound-${this.#nextMessageId++}`;
    const subject = input.subject ?? "Re: confidential security report";
    const rfcMessageId = `<${id}@fake-gmail.test>`;
    const raw = new TextEncoder().encode(
      [
        `From: ${input.from ?? "psirt@example.test"}`,
        `To: ${input.to ?? "researcher@codevault.test"}`,
        `Subject: ${subject}`,
        `Message-ID: ${rfcMessageId}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        input.text,
      ].join("\r\n"),
    );
    const message: FakeGmailMessage = {
      id,
      threadId: input.threadId,
      raw,
      labelIds: ["INBOX"],
      headers: [
        { name: "From", value: input.from ?? "psirt@example.test" },
        { name: "To", value: input.to ?? "researcher@codevault.test" },
        { name: "Subject", value: subject },
        { name: "Message-ID", value: rfcMessageId },
      ],
    };
    this.#messages.set(id, message);
    this.#history.push(id);
    this.#historyId += 1;
    return message;
  }

  pubsubEnvelope(duplicate = false): {
    message: { data: string; messageId: string };
  } {
    if (duplicate && this.#lastPush !== null) return this.#lastPush;
    const messageId = `push-${this.#historyId}`;
    this.#lastPush = {
      message: {
        messageId,
        data: Buffer.from(
          JSON.stringify({
            emailAddress: "researcher@codevault.test",
            historyId: String(this.#historyId),
          }),
        ).toString("base64"),
      },
    };
    return this.#lastPush;
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", this.baseUrl || "http://127.0.0.1");
    if (
      this.#timeoutPath !== null &&
      url.pathname.includes(this.#timeoutPath)
    ) {
      this.#timeoutPath = null;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (url.pathname === "/authorize") {
      const redirect = new URL(
        url.searchParams.get("redirect_uri") ?? this.baseUrl,
      );
      redirect.searchParams.set("code", "fake-authorization-code");
      redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.writeHead(302, { location: redirect.toString() }).end();
      return;
    }
    if (url.pathname === "/token") {
      if (this.#revoked) return json(response, 401, { error: "invalid_grant" });
      return json(response, 200, {
        access_token: "fake-access-token",
        refresh_token: "fake-refresh-token",
        expires_in: 3600,
        scope: [
          "openid",
          "email",
          "https://www.googleapis.com/auth/gmail.send",
          "https://www.googleapis.com/auth/gmail.readonly",
        ].join(" "),
      });
    }
    if (url.pathname === "/revoke") {
      this.#revoked = true;
      response.statusCode = 200;
      response.end();
      return;
    }
    if (this.#revoked) return json(response, 401, { error: "revoked" });
    if (url.pathname === "/userinfo") {
      return json(response, 200, {
        sub: "fake-google-account-1",
        email: "researcher@codevault.test",
        email_verified: true,
      });
    }
    if (url.pathname.endsWith("/settings/sendAs")) {
      return json(response, 200, {
        sendAs: [
          {
            sendAsEmail: "researcher@codevault.test",
            isPrimary: true,
            verificationStatus: "accepted",
          },
        ],
      });
    }
    if (url.pathname.endsWith("/messages/send") && request.method === "POST") {
      const body = JSON.parse((await readBody(request)).toString("utf8")) as {
        raw: string;
        threadId?: string;
      };
      const raw = new Uint8Array(Buffer.from(body.raw, "base64url"));
      const id = `sent-${this.#nextMessageId++}`;
      const message: FakeGmailMessage = {
        id,
        threadId: body.threadId ?? `thread-${id}`,
        raw,
        labelIds: ["SENT"],
        headers: parseHeaders(raw),
      };
      this.#messages.set(id, message);
      this.sentMessages.push(message);
      this.#history.push(id);
      this.#historyId += 1;
      return json(response, 200, {
        id: message.id,
        threadId: message.threadId,
      });
    }
    if (url.pathname.endsWith("/messages") && request.method === "GET") {
      const query = url.searchParams.get("q");
      const wanted = query?.startsWith("rfc822msgid:")
        ? query.slice("rfc822msgid:".length)
        : null;
      const matches = [...this.#messages.values()].filter((message) =>
        message.headers.some(
          (header) =>
            header.name.toLowerCase() === "message-id" &&
            header.value === wanted,
        ),
      );
      return json(response, 200, {
        messages: matches.map(({ id, threadId }) => ({ id, threadId })),
      });
    }
    if (url.pathname.endsWith("/history")) {
      if (this.#expiredHistory) {
        this.#expiredHistory = false;
        return json(response, 404, { error: "history expired" });
      }
      return json(response, 200, {
        historyId: String(this.#historyId),
        history: this.#history.map((id, index) => ({
          id: String(101 + index),
          messagesAdded: [{ message: { id } }],
        })),
      });
    }
    if (url.pathname.endsWith("/profile")) {
      return json(response, 200, { historyId: String(this.#historyId) });
    }
    if (url.pathname.endsWith("/watch") && request.method === "POST") {
      return json(response, 200, {
        historyId: String(this.#historyId),
        expiration: String(Date.now() + 6 * 86_400_000),
      });
    }
    if (url.pathname.endsWith("/stop") && request.method === "POST") {
      response.statusCode = 204;
      response.end();
      return;
    }

    const messageMatch = /\/messages\/([^/]+)$/.exec(url.pathname);
    if (messageMatch?.[1] !== undefined) {
      const id = decodeURIComponent(messageMatch[1]);
      const message = this.#messages.get(id);
      if (message === undefined)
        return json(response, 404, { error: "missing" });
      if (url.searchParams.get("format") === "raw") {
        this.rawFetches.push(id);
        return json(response, 200, {
          id,
          threadId: message.threadId,
          raw: Buffer.from(message.raw).toString("base64url"),
        });
      }
      this.metadataFetches.push(id);
      return json(response, 200, {
        id,
        threadId: message.threadId,
        labelIds: message.labelIds,
        payload: { headers: message.headers },
      });
    }

    const threadMatch = /\/threads\/([^/]+)$/.exec(url.pathname);
    if (threadMatch?.[1] !== undefined) {
      const threadId = decodeURIComponent(threadMatch[1]);
      return json(response, 200, {
        id: threadId,
        messages: [...this.#messages.values()]
          .filter((message) => message.threadId === threadId)
          .map(({ id }) => ({ id })),
      });
    }

    return json(response, 404, {
      error: `Unhandled ${request.method} ${url.pathname}`,
    });
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function parseHeaders(raw: Uint8Array): Array<{ name: string; value: string }> {
  const headerBlock =
    new TextDecoder().decode(raw).split(/\r?\n\r?\n/, 1)[0] ?? "";
  return headerBlock.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(":");
    if (separator < 1) return [];
    return [
      {
        name: line.slice(0, separator),
        value: line.slice(separator + 1).trim(),
      },
    ];
  });
}
