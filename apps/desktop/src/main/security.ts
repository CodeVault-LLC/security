import { URL } from "node:url";

import type { BrowserWindow, Session, WebContents } from "electron";

/**
 * Electron security policy.
 *
 * The renderer displays content derived from vulnerability research: HTTP
 * captures, payloads, filenames and Markdown written by other people. It is
 * treated as a hostile document, and this module is where that assumption is
 * turned into settings.
 *
 * The rules are deliberately stated as data and pure predicates so they can be
 * tested without launching Electron — a sandbox that is only verified by
 * running the app is a sandbox nobody checks.
 */

/** The only origin the primary window may load. */
export const APP_PROTOCOL = "codevault";

export const APP_ORIGIN = `${APP_PROTOCOL}://app`;

/** Schemes `shell.openExternal` will accept, after confirmation. */
export const ALLOWED_EXTERNAL_PROTOCOLS = ["https:", "mailto:"] as const;

/**
 * Content Security Policy.
 *
 * No inline script, no eval, no remote anything. `connect-src` is closed too:
 * every API call goes through the main process, so the renderer has no reason
 * to reach the network by itself — and if it tries, that is a bug worth
 * failing loudly.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `script-src ${APP_PROTOCOL}:`,
  `style-src ${APP_PROTOCOL}: 'unsafe-inline'`,
  `img-src ${APP_PROTOCOL}: data: blob:`,
  `font-src ${APP_PROTOCOL}: data:`,
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Permissions the renderer may request.
 *
 * None of them. A research workstation tool has no business asking for a
 * camera, a microphone, geolocation or notifications, and refusing everything
 * by default means a future dependency cannot quietly acquire one.
 */
export const GRANTED_PERMISSIONS: readonly string[] = [];

/** Control characters, which never legitimately appear in a link. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    return (
      parsed.protocol === `${APP_PROTOCOL}:` &&
      parsed.host === "app"
    );
  } catch {
    return false;
  }
}

/**
 * Whether the primary window may navigate to a URL.
 *
 * Only the application's own origin. A finding's Markdown can contain any link
 * at all, and a navigation would replace the researcher's workspace with an
 * attacker's page inside a window that has a preload bridge attached.
 */
export function isNavigationAllowed(url: string, isDevelopment = false): boolean {
  if (isAppUrl(url)) {
    return true;
  }

  if (isDevelopment) {
    // The Vite dev server is the renderer's origin while developing. It is
    // never consulted in a packaged build.
    return (
      url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")
    );
  }

  return false;
}

/**
 * Whether a URL may be handed to the operating system's browser.
 *
 * `https:` and `mailto:` only. Everything else — `file:`, `javascript:`,
 * `smb:`, custom handlers registered by other applications — is refused,
 * because "open this link" must not be a way to reach a local handler.
 */
export function isExternalUrlAllowed(url: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.includes(parsed.protocol as "https:")) {
    return false;
  }

  if (parsed.protocol === "https:" && parsed.hostname.length === 0) {
    return false;
  }

  // A URL containing control characters is either malformed or an attempt to
  // smuggle something past a downstream parser.
  return !CONTROL_CHARACTERS.test(url);
}

/** Web preferences every CodeVault window is created with. */
export const SECURE_WEB_PREFERENCES = {
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  // The renderer never embeds remote content, so there is nothing to isolate
  // into a webview — and webviews are a well-known escape surface.
  webviewTag: false,
  spellcheck: true,
} as const;

export interface SecurityHooks {
  /** Called when navigation to a non-application URL is refused. */
  onBlockedNavigation?: (url: string) => void;
  /** Called when a window tried to open a URL; returns whether it was allowed. */
  onExternalRequest?: (url: string, allowed: boolean) => void;
}

/**
 * Applies navigation and window-opening policy to a `webContents`.
 *
 * Every rule here is a refusal by default: navigation is blocked unless it is
 * the application origin, and a new window is never created — the request is
 * turned into an external-open decision instead.
 */
export function applyWebContentsPolicy(
  contents: WebContents,
  options: {
    isDevelopment: boolean;
    openExternal: (url: string) => Promise<void>;
    hooks?: SecurityHooks;
  },
): void {
  contents.on("will-navigate", (event, url) => {
    if (isNavigationAllowed(url, options.isDevelopment)) {
      return;
    }

    event.preventDefault();
    options.hooks?.onBlockedNavigation?.(url);
  });

  contents.setWindowOpenHandler(({ url }) => {
    const allowed = isExternalUrlAllowed(url);

    options.hooks?.onExternalRequest?.(url, allowed);

    if (allowed) {
      void options.openExternal(url);
    }

    // Never `allow`: CodeVault has no second window, and a popup created by
    // page content would inherit this window's preload bridge.
    return { action: "deny" };
  });

  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

/** Applies the CSP and permission policy to a session. */
export function applySessionPolicy(session: Session): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CONTENT_SECURITY_POLICY],
        "X-Content-Type-Options": ["nosniff"],
        "Referrer-Policy": ["no-referrer"],
      },
    });
  });

  session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(GRANTED_PERMISSIONS.includes(permission));
  });

  session.setPermissionCheckHandler((_contents, permission) =>
    GRANTED_PERMISSIONS.includes(permission),
  );
}

/** Refuses devtools in a packaged build, where it is only ever an attack aid. */
export function applyWindowPolicy(
  window: BrowserWindow,
  isDevelopment: boolean,
): void {
  window.webContents.on("devtools-opened", () => {
    if (!isDevelopment) {
      window.webContents.closeDevTools();
    }
  });
}
