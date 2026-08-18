import type { CodeVaultDesktopApi } from "../../../preload/contracts.js";

/**
 * The desktop bridge, as the renderer sees it.
 *
 * Everything the renderer can do off-screen goes through this object. It is
 * the only global the application touches, and it is read once here so that
 * feature code depends on a typed function rather than on `window`.
 */

declare global {
  interface Window {
    codevault?: CodeVaultDesktopApi;
  }
}

export class BridgeUnavailableError extends Error {
  constructor() {
    super(
      "The CodeVault Security desktop bridge is unavailable. " +
        "The renderer is running outside the application shell.",
    );

    this.name = "BridgeUnavailableError";
  }
}

export function bridge(): CodeVaultDesktopApi {
  const api = window.codevault;

  if (api === undefined) {
    throw new BridgeUnavailableError();
  }

  return api;
}

export function hasBridge(): boolean {
  return window.codevault !== undefined;
}
