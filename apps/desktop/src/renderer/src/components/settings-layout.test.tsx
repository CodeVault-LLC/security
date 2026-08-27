import type * as TanStackRouter from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  OrganizationSettingsPage,
  PersonalSettingsPage,
} from "./settings-layout.js";

let pathname = "/organization/security";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original = await importOriginal<typeof TanStackRouter>();
  return {
    ...original,
    Link: ({
      to,
      children,
      ...props
    }: {
      to: string;
      children: React.ReactNode;
      [key: string]: unknown;
    }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
    useRouterState: ({
      select,
    }: {
      select: (state: { location: { pathname: string } }) => unknown;
    }) => select({ location: { pathname } }),
  };
});

describe("settings layouts", () => {
  it("keeps every organization section in one persistent navigation model", () => {
    render(
      <OrganizationSettingsPage
        title="Security & access"
        description="Organization-wide requirements."
      >
        <p>Policy content</p>
      </OrganizationSettingsPage>,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Settings sections",
    });
    expect(navigation).toBeTruthy();
    expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "General" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Security & access" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("uses the same shell for personal settings", () => {
    pathname = "/settings/profile";
    render(
      <PersonalSettingsPage title="Profile" description="Personal details.">
        <p>Profile content</p>
      </PersonalSettingsPage>,
    );

    expect(
      screen.getByRole("heading", { name: "Personal settings" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Profile" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByRole("link", { name: "Mail" })).toBeTruthy();
  });
});
