import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginScreen } from "./login-screen.js";

const authBridge = vi.hoisted(() => ({
  loginStart: vi.fn(),
  loginComplete: vi.fn(),
}));

vi.mock("../../lib/bridge.js", () => ({
  bridge: () => ({ auth: authBridge }),
}));

describe("LoginScreen branding", () => {
  beforeEach(() => {
    authBridge.loginStart.mockReset();
    authBridge.loginComplete.mockReset();
  });

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

describe("LoginScreen session persistence", () => {
  beforeEach(() => {
    authBridge.loginStart.mockReset();
    authBridge.loginComplete.mockReset();
  });

  it("passes the remember-me choice into the login flow", async () => {
    const user = userEvent.setup();
    authBridge.loginStart.mockResolvedValue({
      ok: true,
      data: {
        challenge: "MFA_REQUIRED",
        expiresAt: "2030-01-01T00:00:00.000Z",
      },
    });
    render(<LoginScreen />);

    await user.type(
      screen.getByRole("textbox", { name: "Organization email" }),
      "researcher@example.test",
    );
    await user.type(screen.getByLabelText("Password"), "long-test-password");
    await user.click(screen.getByRole("checkbox", { name: "Remember me" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(authBridge.loginStart).toHaveBeenCalledWith(
      "https://codevault.internal",
      "researcher@example.test",
      "long-test-password",
      true,
    );
  });

  it("explains how long a remembered session lasts", () => {
    render(<LoginScreen />);

    expect(
      screen.getByText("Keeps you signed in on this device for up to 7 days."),
    ).toBeTruthy();
  });
});

describe("LoginScreen credential autofill", () => {
  it("exposes a standard username and current-password form", () => {
    render(<LoginScreen />);

    const email = screen.getByRole("textbox", {
      name: "Organization email",
    });
    const password = screen.getByLabelText("Password");
    const form = screen
      .getByRole("button", { name: "Continue" })
      .closest("form");

    expect(form?.getAttribute("autocomplete")).toBe("on");
    expect(email.getAttribute("name")).toBe("username");
    expect(email.getAttribute("autocomplete")).toBe("username");
    expect(password.getAttribute("name")).toBe("password");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
  });
});
