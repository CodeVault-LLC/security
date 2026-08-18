import { describe, expect, test } from "vitest";
import { randomBytes } from "node:crypto";

import { loadConfig } from "./config.js";

const base = {
  DATABASE_URL: "postgres://localhost/test",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_BUCKET: "test",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
};

describe("Gmail configuration", () => {
  test("is disabled and credential-free by default", () => {
    expect(loadConfig(base).gmail).toEqual({ enabled: false });
  });

  test("fails closed when enabled without every security setting", () => {
    expect(() => loadConfig({ ...base, GMAIL_ENABLED: "true" })).toThrow(
      "GMAIL_CLIENT_ID",
    );
  });

  test("accepts an exact HTTPS callback and versioned token keys", () => {
    const config = loadConfig({
      ...base,
      GMAIL_ENABLED: "true",
      GMAIL_CLIENT_ID: "client.apps.googleusercontent.com",
      GMAIL_CLIENT_SECRET: "development-client-secret",
      GMAIL_REDIRECT_URI: "https://codevault.example/v1/mail/gmail/callback",
      MAIL_TOKEN_KEYRING: `1:${randomBytes(32).toString("base64")}`,
      MAIL_ACTIVE_TOKEN_KEY_VERSION: "1",
    });

    expect(config.gmail.enabled).toBe(true);
    if (config.gmail.enabled) {
      expect(config.gmail.tokenKeyring.keys.get(1)?.byteLength).toBe(32);
      expect(config.gmail.pubsub).toBeNull();
    }
  });

  test("rejects insecure non-loopback callbacks", () => {
    expect(() =>
      loadConfig({
        ...base,
        GMAIL_ENABLED: "true",
        GMAIL_CLIENT_ID: "client",
        GMAIL_CLIENT_SECRET: "secret",
        GMAIL_REDIRECT_URI: "http://codevault.example/callback",
        MAIL_TOKEN_KEYRING: `1:${randomBytes(32).toString("base64")}`,
        MAIL_ACTIVE_TOKEN_KEY_VERSION: "1",
      }),
    ).toThrow("HTTPS");
  });

  test("refuses fake Gmail endpoints outside the test environment", () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: "production",
        GMAIL_ENABLED: "true",
        GMAIL_CLIENT_ID: "client",
        GMAIL_CLIENT_SECRET: "secret",
        GMAIL_REDIRECT_URI: "https://codevault.example/callback",
        MAIL_TOKEN_KEYRING: `1:${randomBytes(32).toString("base64")}`,
        MAIL_ACTIVE_TOKEN_KEY_VERSION: "1",
        GMAIL_E2E_BASE_URL: "http://127.0.0.1:4444",
      }),
    ).toThrow("test-only");
  });

  test("permits an exact loopback fake only in the test environment", () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: "test",
      GMAIL_ENABLED: "true",
      GMAIL_CLIENT_ID: "client",
      GMAIL_CLIENT_SECRET: "secret",
      GMAIL_REDIRECT_URI: "http://127.0.0.1:4310/v1/mail/gmail/callback",
      MAIL_TOKEN_KEYRING: `1:${randomBytes(32).toString("base64")}`,
      MAIL_ACTIVE_TOKEN_KEY_VERSION: "1",
      GMAIL_E2E_BASE_URL: "http://127.0.0.1:4444",
    });
    expect(config.gmail.enabled && config.gmail.endpoints?.gmailApi).toBe(
      "http://127.0.0.1:4444/gmail/v1",
    );
  });
});
