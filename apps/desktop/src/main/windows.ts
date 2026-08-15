import { join } from "node:path";

import { BrowserWindow, shell } from "electron";

import {
  APP_ORIGIN,
  applyWebContentsPolicy,
  applyWindowPolicy,
  isExternalUrlAllowed,
  SECURE_WEB_PREFERENCES,
} from "./security.js";

/**
 * Window creation.
 *
 * One window, created with the hardened preferences and with the navigation
 * policy attached before anything is loaded into it.
 */

export interface CreateWindowOptions {
  preloadPath: string;
  isDevelopment: boolean;
  /** Vite dev server URL while developing; ignored in a packaged build. */
  devServerUrl?: string | undefined;
  onBlockedNavigation?: (url: string) => void;
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1_024,
    minHeight: 640,
    // The window is created hidden and shown once the renderer has painted, so
    // the researcher never sees an empty white frame.
    show: false,
    backgroundColor: "#111417",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: options.preloadPath,
    },
  });

  applyWebContentsPolicy(window.webContents, {
    isDevelopment: options.isDevelopment,
    openExternal: async (url: string) => {
      if (isExternalUrlAllowed(url)) {
        await shell.openExternal(url);
      }
    },
    hooks: {
      ...(options.onBlockedNavigation === undefined
        ? {}
        : { onBlockedNavigation: options.onBlockedNavigation }),
    },
  });

  applyWindowPolicy(window, options.isDevelopment);

  window.once("ready-to-show", () => {
    window.show();
  });

  const target =
    options.isDevelopment && options.devServerUrl !== undefined
      ? options.devServerUrl
      : `${APP_ORIGIN}/index.html`;

  void window.loadURL(target);

  return window;
}

export function rendererRootFrom(appPath: string): string {
  return join(appPath, "out", "renderer");
}
