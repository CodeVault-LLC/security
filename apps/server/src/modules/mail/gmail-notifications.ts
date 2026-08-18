export interface GmailNotification {
  notificationId: string;
  emailAddress: string;
  historyId: string;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid Pub/Sub notification.");
  }
  return value as Record<string, unknown>;
}

/** Parses only the routing facts Google places in a Gmail push notification. */
export function decodePubSubNotification(value: unknown): GmailNotification {
  const envelope = object(value);
  const message = object(envelope.message);
  if (
    typeof message.messageId !== "string" ||
    message.messageId.length < 1 ||
    message.messageId.length > 500 ||
    typeof message.data !== "string" ||
    message.data.length > 8_192 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)
  ) {
    throw new Error("Invalid Pub/Sub message envelope.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(message.data, "base64").toString("utf8"));
  } catch {
    throw new Error("Invalid Gmail notification data.");
  }
  const data = object(decoded);
  if (
    typeof data.emailAddress !== "string" ||
    data.emailAddress.length > 320 ||
    !/^[^\s@\r\n]+@[^\s@\r\n]+$/.test(data.emailAddress) ||
    typeof data.historyId !== "string" ||
    !/^\d{1,30}$/.test(data.historyId)
  ) {
    throw new Error("Invalid Gmail notification facts.");
  }
  return {
    notificationId: message.messageId,
    emailAddress: data.emailAddress.toLowerCase(),
    historyId: data.historyId,
  };
}

export async function verifyGooglePushToken(
  token: string,
  expected: { audience: string; serviceAccountEmail: string },
): Promise<void> {
  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: expected.audience,
  });
  if (
    payload.email !== expected.serviceAccountEmail ||
    payload.email_verified !== true
  ) {
    throw new Error("The Pub/Sub service identity did not match.");
  }
}
import { createRemoteJWKSet, jwtVerify } from "jose";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
