import { describe, expect, it } from "vitest";

import {
  ALLOWED_EXTERNAL_PROTOCOLS,
  APP_ORIGIN,
  CONTENT_SECURITY_POLICY,
  contentSecurityPolicyFor,
  GRANTED_PERMISSIONS,
  isAppUrl,
  isExternalUrlAllowed,
  isNavigationAllowed,
  isProtectedNativeOnlyApiPath,
  normalizeServerUrl,
  PASSPHRASE_PROMPT_WEB_PREFERENCES,
  SECURE_WEB_PREFERENCES,
} from "./security.js";

describe("renderer capability boundary", () => {
  it("requires named native operations for sealing and sending", () => {
    const id = "018f2f56-7c9a-7abc-8def-0123456789ab";
    expect(isProtectedNativeOnlyApiPath(`/v1/submissions/${id}/seal`)).toBe(
      true,
    );
    expect(isProtectedNativeOnlyApiPath(`/v1/submissions/${id}/send`)).toBe(
      true,
    );
    expect(isProtectedNativeOnlyApiPath(`/v1/submissions/${id}`)).toBe(false);
  });
});

describe("private-key passphrase boundary", () => {
  it("runs the trusted prompt without Node, DevTools, or a preload bridge", () => {
    expect(PASSPHRASE_PROMPT_WEB_PREFERENCES).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false,
      webviewTag: false,
    });
    expect(PASSPHRASE_PROMPT_WEB_PREFERENCES).not.toHaveProperty("preload");
  });
});

/**
 * Electron sandbox tests.
 *
 * These assert the properties the whole desktop threat model rests on. If any
 * of them fails, a payload rendered inside a finding has a path out of the
 * renderer, so they are written as flat, unambiguous assertions rather than as
 * a survey of behaviour.
 */

describe("window preferences", () => {
  it("keeps Node out of the renderer", () => {
    expect(SECURE_WEB_PREFERENCES.nodeIntegration).toBe(false);
    expect(SECURE_WEB_PREFERENCES.nodeIntegrationInWorker).toBe(false);
    expect(SECURE_WEB_PREFERENCES.nodeIntegrationInSubFrames).toBe(false);
  });

  it("isolates context and enables the sandbox", () => {
    expect(SECURE_WEB_PREFERENCES.contextIsolation).toBe(true);
    expect(SECURE_WEB_PREFERENCES.sandbox).toBe(true);
  });

  it("keeps web security on and refuses insecure content", () => {
    expect(SECURE_WEB_PREFERENCES.webSecurity).toBe(true);
    expect(SECURE_WEB_PREFERENCES.allowRunningInsecureContent).toBe(false);
  });

  it("disables webviews and experimental features", () => {
    expect(SECURE_WEB_PREFERENCES.webviewTag).toBe(false);
    expect(SECURE_WEB_PREFERENCES.experimentalFeatures).toBe(false);
  });
});

describe("navigation policy", () => {
  it("allows the application origin", () => {
    expect(isNavigationAllowed(`${APP_ORIGIN}/`)).toBe(true);
    expect(isNavigationAllowed(`${APP_ORIGIN}/findings/1`)).toBe(true);
    expect(isAppUrl(`${APP_ORIGIN}/index.html`)).toBe(true);
  });

  it("refuses every remote origin", () => {
    expect(isNavigationAllowed("https://example.com")).toBe(false);
    expect(isNavigationAllowed("http://example.com")).toBe(false);
    expect(isNavigationAllowed("file:///etc/passwd")).toBe(false);
    expect(isNavigationAllowed("javascript:alert(1)")).toBe(false);
  });

  it("refuses a lookalike host on the application protocol", () => {
    expect(isNavigationAllowed("codevault://evil/index.html")).toBe(false);
    expect(isAppUrl("codevault://app.evil.com/")).toBe(false);
  });

  it("permits the dev server only while developing", () => {
    expect(isNavigationAllowed("http://localhost:5173/", true)).toBe(true);
    expect(isNavigationAllowed("http://localhost:5173/", false)).toBe(false);
  });
});

describe("external link policy", () => {
  it("allows https and mailto", () => {
    expect(
      isExternalUrlAllowed("https://nvd.nist.gov/vuln/detail/CVE-2026-1"),
    ).toBe(true);
    expect(isExternalUrlAllowed("mailto:security@vendor.example")).toBe(true);
  });

  it("refuses schemes that reach a local handler", () => {
    expect(isExternalUrlAllowed("file:///etc/shadow")).toBe(false);
    expect(isExternalUrlAllowed("javascript:alert(1)")).toBe(false);
    expect(
      isExternalUrlAllowed("data:text/html,<script>alert(1)</script>"),
    ).toBe(false);
    expect(isExternalUrlAllowed("smb://192.168.1.10/share")).toBe(false);
    expect(isExternalUrlAllowed("vscode://file/etc/passwd")).toBe(false);
    expect(isExternalUrlAllowed("http://example.com")).toBe(false);
  });

  it("refuses malformed input and control characters", () => {
    expect(isExternalUrlAllowed("not a url")).toBe(false);
    expect(isExternalUrlAllowed("https://")).toBe(false);
    expect(isExternalUrlAllowed("https://example.com/\0")).toBe(false);
    expect(isExternalUrlAllowed("https://example.com/\r\nHost: evil")).toBe(
      false,
    );
  });

  it("permits exactly two schemes", () => {
    expect([...ALLOWED_EXTERNAL_PROTOCOLS]).toEqual(["https:", "mailto:"]);
  });
});

describe("organization server URL policy", () => {
  it("accepts only canonical HTTPS origins and loopback development HTTP", () => {
    expect(normalizeServerUrl("https://vault.example.test/path")).toBe(
      "https://vault.example.test",
    );
    expect(normalizeServerUrl("http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000",
    );
    expect(normalizeServerUrl("http://vault.example.test")).toBeNull();
    expect(normalizeServerUrl("file:///etc/passwd")).toBeNull();
    expect(
      normalizeServerUrl("https://user:pass@vault.example.test"),
    ).toBeNull();
    expect(
      normalizeServerUrl("https://vault.example.test?token=secret"),
    ).toBeNull();
  });
});

describe("content security policy", () => {
  it("denies everything by default", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
  });

  it("forbids inline script and eval", () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-inline'; script");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");

    const scriptDirective = CONTENT_SECURITY_POLICY.split("; ").find((part) =>
      part.startsWith("script-src"),
    );

    expect(scriptDirective).toBe("script-src codevault:");
  });

  it("forbids the renderer from reaching the network", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
  });

  it("allows same-origin srcdoc mail previews but forbids foreign framing", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("frame-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });
});

describe("development content security policy", () => {
  const devPolicy = contentSecurityPolicyFor({
    isDevelopment: true,
    devServerUrl: "http://localhost:5173/",
  });

  it("is only used when the build is actually a development build", () => {
    // An environment variable must never be able to loosen a packaged build.
    expect(
      contentSecurityPolicyFor({
        isDevelopment: false,
        devServerUrl: "http://localhost:5173/",
      }),
    ).toBe(CONTENT_SECURITY_POLICY);

    expect(
      contentSecurityPolicyFor({
        isDevelopment: true,
        devServerUrl: undefined,
      }),
    ).toBe(CONTENT_SECURITY_POLICY);
  });

  it("falls back to the closed policy for an unparseable dev URL", () => {
    expect(
      contentSecurityPolicyFor({
        isDevelopment: true,
        devServerUrl: "not a url",
      }),
    ).toBe(CONTENT_SECURITY_POLICY);
  });

  it("widens to the dev server origin and nothing else", () => {
    expect(devPolicy).toContain("script-src codevault: http://localhost:5173");
    expect(devPolicy).toContain(
      "connect-src http://localhost:5173 ws://localhost:5173",
    );
    expect(devPolicy).not.toContain("http:;");
    expect(devPolicy).not.toContain("*");
  });

  it("keeps the refusals that are not about serving the renderer", () => {
    expect(devPolicy).toContain("default-src 'none'");
    expect(devPolicy).toContain("object-src 'none'");
    expect(devPolicy).toContain("frame-src 'self'");
    expect(devPolicy).toContain("frame-ancestors 'none'");
    expect(devPolicy).toContain("form-action 'none'");
  });
});

describe("permission policy", () => {
  it("grants no browser permissions at all", () => {
    expect(GRANTED_PERMISSIONS).toHaveLength(0);
  });
});
