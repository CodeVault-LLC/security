import { join } from "node:path";

import { app, BrowserWindow, session } from "electron";

import { createApiClient } from "./api-client.js";
import { createProviderRegistry } from "./agents/registry.js";
import { createEventBridge } from "./events.js";
import { registerIpcHandlers } from "./ipc.js";
import { IPC_CHANNELS } from "../preload/contracts.js";
import { registerAppProtocol, registerProtocolSchemes } from "./protocol.js";
import { applySessionPolicy } from "./security.js";
import { createSessionStore } from "./session-store.js";
import { createSigningKeyStore } from "./crypto/signing-key-store.js";
import { createMainWindow } from "./windows.js";

/**
 * Main process entry point.
 *
 * Order matters here. The sandbox is enabled and the protocol scheme is
 * registered before the app is ready, because both are refused afterwards, and
 * a window is never created before the session policy is in place.
 */

// Must be called before `app.whenReady()`. With it, renderer processes are
// sandboxed at the OS level in addition to Electron's own isolation.
app.enableSandbox();

registerProtocolSchemes();

const isDevelopment = !app.isPackaged;
const devServerUrl = process.env.ELECTRON_RENDERER_URL;

/** In-flight AI runs, so a cancel request can reach the right child process. */
const cancellations = new Map<string, AbortController>();

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  applySessionPolicy(session.defaultSession, {
    isDevelopment,
    devServerUrl,
  });

  if (!isDevelopment) {
    registerAppProtocol(join(app.getAppPath(), "out", "renderer"));
  } else {
    // The dev server serves the renderer, but the protocol is still registered
    // so a production-mode check in development behaves identically.
    registerAppProtocol(join(app.getAppPath(), "out", "renderer"));
  }

  const sessionStore = createSessionStore();
  const apiClient = createApiClient({
    sessionStore,
    onSessionExpired: () => {
      mainWindow?.webContents.send(IPC_CHANNELS.authSessionExpired);
    },
  });
  const providers = createProviderRegistry();
  const signingKeys = createSigningKeyStore();

  const events = createEventBridge({
    sessionStore,
    onEvent: (event) => {
      mainWindow?.webContents.send(IPC_CHANNELS.eventsMessage, event);
    },
    onConnectionChange: (connected) => {
      mainWindow?.webContents.send(IPC_CHANNELS.eventsConnection, connected);
    },
  });

  registerIpcHandlers({
    window: () => mainWindow,
    sessionStore,
    apiClient,
    providers,
    signingKeys,
    registerCancellation: (runId, controller) => {
      cancellations.set(runId, controller);
    },
    cancelRun: (runId) => {
      cancellations.get(runId)?.abort();
      cancellations.delete(runId);
    },
  });

  mainWindow = createMainWindow({
    preloadPath: join(app.getAppPath(), "out", "preload", "index.js"),
    isDevelopment,
    devServerUrl,
    onBlockedNavigation: (url) => {
      console.warn(`[security] blocked navigation to ${url}`);
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    events.stop();
  });

  events.start();
}

void app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void bootstrap();
  }
});

/**
 * Refuses a second instance.
 *
 * Two instances would race over the session file and the AI cancellation map.
 * The existing window is focused instead.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      mainWindow.focus();
    }
  });
}

/**
 * Refuses every certificate error.
 *
 * The desktop client talks to one server over TLS. Accepting a bad certificate
 * "just this once" is how a researcher's session token ends up on someone
 * else's machine.
 */
app.on(
  "certificate-error",
  (event, _webContents, _url, _error, _cert, callback) => {
    event.preventDefault();
    callback(false);
  },
);
