import { describe, expect, it } from "vitest";

import { createAppRouter } from "./router.js";

describe("settings route ownership boundaries", () => {
  it("exposes categorized organization and personal routes without an organization landing page", () => {
    const paths = Object.keys(createAppRouter().routesByPath);

    expect(paths).toEqual(
      expect.arrayContaining([
        "/organization/users",
        "/organization/users/$userId",
        "/organization/settings",
        "/organization/security",
        "/settings/profile",
        "/settings/appearance",
        "/settings/ai",
        "/settings/security",
        "/settings/mail",
      ]),
    );
    expect(paths).not.toContain("/organization");
  });
});
