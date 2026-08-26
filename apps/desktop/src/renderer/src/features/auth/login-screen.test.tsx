import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginScreen } from "./login-screen.js";
import { useSession } from "../../lib/session.js";

const authBridge = vi.hoisted(() => ({
  preflight: vi.fn(),
  loginStart: vi.fn(),
  loginComplete: vi.fn(),
  loginSecurityKey: vi.fn(),
}));

const appBridge = vi.hoisted(() => ({ version: vi.fn() }));

vi.mock("../../lib/bridge.js", () => ({
  bridge: () => ({ app: appBridge, auth: authBridge }),
}));

afterEach(() => vi.restoreAllMocks());

function resetBridge(): void {
  useSession.getState().signOut();
  authBridge.preflight.mockReset();
  authBridge.preflight.mockResolvedValue({
    ok: true,
    data: {
      status: "ok",
      apiVersion: "v1",
      serverVersion: "0.1.0-alpha.7",
      compatible: true,
      compatibilityMessage: null,
    },
  });
  authBridge.loginStart.mockReset();
  authBridge.loginComplete.mockReset();
  appBridge.version.mockReset();
  appBridge.version.mockResolvedValue("0.1.0-alpha.7");
}

describe("LoginScreen branding", () => {
  beforeEach(() => {
    resetBridge();
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
    resetBridge();
  });

  it("passes the remember-me choice into the login flow", async () => {
    const user = userEvent.setup();
    authBridge.loginStart.mockResolvedValue({
      ok: true,
      data: {
        challenge: "MFA_REQUIRED",
        methods: ["TOTP"],
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
    await screen.findByText(/Connected to CodeVault Server/u);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(authBridge.loginStart).toHaveBeenCalledWith(
      "http://localhost:4310",
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

  it("signs in directly when the organization does not require MFA", async () => {
    const user = userEvent.setup();
    authBridge.loginStart.mockResolvedValue({
      ok: true,
      data: {
        user: {
          id: "00000000-0000-4000-8000-000000000001",
          email: "researcher@example.test",
          displayName: "Researcher",
          role: "MEMBER",
          createdAt: "2026-08-25T08:00:00.000Z",
          lastLoginAt: null,
        },
        persistent: false,
        storageWarning: null,
      },
    });
    render(<LoginScreen />);

    await user.type(
      screen.getByRole("textbox", { name: "Organization email" }),
      "researcher@example.test",
    );
    await user.type(screen.getByLabelText("Password"), "long-test-password");
    await screen.findByText(/Connected to CodeVault Server/u);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(useSession.getState().status).toBe("SIGNED_IN");
    });
    expect(useSession.getState().user?.email).toBe("researcher@example.test");
    expect(screen.queryByText(/Authenticator code/u)).toBeNull();
  });

  it("signs in when server preference storage is unavailable", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });
    authBridge.loginStart.mockResolvedValue({
      ok: true,
      data: {
        user: {
          id: "00000000-0000-4000-8000-000000000001",
          email: "researcher@example.test",
          displayName: "Researcher",
          role: "MEMBER",
          createdAt: "2026-08-25T08:00:00.000Z",
          lastLoginAt: null,
        },
        persistent: false,
        storageWarning: null,
      },
    });

    render(<LoginScreen />);

    await user.type(
      screen.getByRole("textbox", { name: "Organization email" }),
      "researcher@example.test",
    );
    await user.type(screen.getByLabelText("Password"), "long-test-password");
    await screen.findByText(/Connected to CodeVault Server/u);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(useSession.getState().status).toBe("SIGNED_IN");
    });
  });
});

describe("LoginScreen credential autofill", () => {
  beforeEach(() => resetBridge());

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
