import { randomUUID } from "node:crypto";

import { BrowserWindow, type WebContents } from "electron";

import {
  normalizeServerUrl,
  PASSPHRASE_PROMPT_WEB_PREFERENCES,
} from "./security.js";

export type WebAuthnCeremonyKind = "register" | "authenticate";

function isCeremonyUrl(url: string, expected: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.toString() === expected;
  } catch {
    return false;
  }
}

function lockNavigation(contents: WebContents, ceremonyUrl: string): void {
  const refuseUnexpectedUrl = (event: Electron.Event, url: string): void => {
    if (!isCeremonyUrl(url, ceremonyUrl)) event.preventDefault();
  };
  contents.on("will-navigate", refuseUnexpectedUrl);
  contents.on("will-redirect", refuseUnexpectedUrl);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

/**
 * Runs navigator.credentials from an isolated window at the RP's real origin.
 * The main renderer never receives WebAuthn options and the ceremony window has
 * no preload, cookies, persistent storage, Node integration, or API token.
 */
export async function runWebAuthnCeremony(
  parent: BrowserWindow,
  serverUrl: string,
  kind: WebAuthnCeremonyKind,
  options: unknown,
): Promise<unknown> {
  const normalized = normalizeServerUrl(serverUrl);
  if (normalized === null) throw new Error("The server URL is not allowed.");
  const ceremonyUrl = new URL(
    "/v1/auth/webauthn/ceremony",
    normalized,
  ).toString();
  const window = new BrowserWindow({
    parent,
    modal: true,
    width: 480,
    height: 340,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    backgroundColor: "#111417",
    title: "CodeVault security key",
    webPreferences: {
      ...PASSPHRASE_PROMPT_WEB_PREFERENCES,
      partition: `codevault-webauthn-${randomUUID()}`,
    },
  });
  lockNavigation(window.webContents, ceremonyUrl);
  window.once("ready-to-show", () => window.show());
  try {
    await window.loadURL(ceremonyUrl);
    const expression = `window.codevaultWebAuthn.${kind}(${JSON.stringify(options)})`;
    return await window.webContents.executeJavaScript(expression, true);
  } catch (error: unknown) {
    const name =
      typeof error === "object" && error !== null && "name" in error
        ? String(error.name)
        : "";
    if (name === "NotAllowedError" || name === "AbortError") {
      throw new Error("Security-key verification was cancelled.");
    }
    throw new Error("The security-key ceremony could not be completed.");
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}
