import { describe, expect, it } from "vitest";

import { assertMediaCredentialPosture } from "./index.js";

describe("media-worker production credentials", () => {
  it("refuses the development database password", () => {
    expect(() =>
      assertMediaCredentialPosture({
        NODE_ENV: "production",
        MEDIA_DATABASE_URL:
          "postgres://codevault_media_login:codevault_media_dev_password@postgres/codevault",
        MEDIA_S3_ACCESS_KEY_ID: "production-media",
        MEDIA_S3_SECRET_ACCESS_KEY: "production-secret",
      }),
    ).toThrow("known development credential");
  });

  it("does not apply the production-only rule in development", () => {
    expect(() =>
      assertMediaCredentialPosture({
        NODE_ENV: "development",
        MEDIA_S3_ACCESS_KEY_ID: "codevault-media",
      }),
    ).not.toThrow();
  });
});
