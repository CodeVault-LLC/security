import { describe, expect, it } from "vitest";

import { buildProductionSecrets } from "./create-production-secrets.js";

describe("production secret generation", () => {
  it("creates distinct database credentials and matching URLs", () => {
    const secrets = buildProductionSecrets();
    const appUrl = new URL(secrets.database_url as string);
    const mediaUrl = new URL(secrets.media_database_url as string);

    expect(appUrl.username).toBe("codevault_app");
    expect(decodeURIComponent(appUrl.password)).toBe(
      secrets.database_app_password,
    );
    expect(mediaUrl.username).toBe("codevault_media_login");
    expect(decodeURIComponent(mediaUrl.password)).toBe(
      secrets.media_database_password,
    );
    expect(secrets.database_app_password).not.toBe(
      secrets.media_database_password,
    );
  });

  it("creates a 32-byte MFA key", () => {
    const secrets = buildProductionSecrets();
    const [, encoded] = (secrets.mfa_encryption_keys as string).split(":");

    expect(Buffer.from(encoded as string, "base64")).toHaveLength(32);
  });
});
