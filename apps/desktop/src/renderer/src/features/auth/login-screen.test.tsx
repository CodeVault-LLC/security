import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LoginScreen } from "./login-screen.js";

describe("LoginScreen branding", () => {
  it("identifies the product as CodeVault Security", () => {
    render(<LoginScreen />);

    expect(
      screen.getByRole("heading", { name: "CodeVault Security" }),
    ).toBeTruthy();
  });

  it("emphasizes Security as the product name", () => {
    render(<LoginScreen />);

    expect(screen.getByText("Security", { selector: "strong" })).toBeTruthy();
  });

  it("uses the approved four-word product slogan", () => {
    render(<LoginScreen />);

    expect(
      screen.getByText("Security research. Responsible disclosure."),
    ).toBeTruthy();
  });

  it("does not disclose the account admission policy", () => {
    render(<LoginScreen />);

    expect(screen.queryByText(/invitation-only/iu)).toBeNull();
    expect(screen.queryByText(/public registration/iu)).toBeNull();
    expect(
      screen.getByText(
        "Authorized access only. Activity is monitored and audited.",
      ),
    ).toBeTruthy();
  });

  it("keeps the product header when opening invitation onboarding", async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.click(
      screen.getByRole("button", {
        name: "I have an organization invitation",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "CodeVault Security" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Security research. Responsible disclosure."),
    ).toBeTruthy();
  });
});
