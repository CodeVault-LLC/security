import { contextBridge, ipcRenderer } from "electron";

import {
  IPC_CHANNELS,
  type ApiOutcome,
  type ApiRequestOptions,
  type CodeVaultDesktopApi,
  type StartUploadRequest,
  type UploadProgress,
  type UploadSelection,
} from "./contracts.js";

/**
 * The preload bridge.
 *
 * Exposes a fixed set of named operations on `window.codevault`. It does not
 * expose `ipcRenderer`, a generic `invoke`, a channel name, `require`, or any
 * Node built-in. The renderer's entire capability surface is the object built
 * below, which is what makes "the renderer is compromised" a bounded event
 * rather than a full workstation compromise.
 */

/**
 * Wraps a listener registration so the renderer never receives the Electron
 * event object — which carries `sender`, and through it a route back to the
 * main process that bypasses this bridge.
 */
function subscribe<T>(
  channel: string,
  listener: (payload: T) => void,
): () => void {
  const handler = (_event: unknown, payload: T): void => {
    listener(payload);
  };

  ipcRenderer.on(channel, handler);

  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: CodeVaultDesktopApi = {
  app: {
    version: () =>
      ipcRenderer.invoke(IPC_CHANNELS.appVersion) as Promise<string>,
    platform: () =>
      ipcRenderer.invoke(IPC_CHANNELS.appPlatform) as Promise<
        "darwin" | "win32" | "linux"
      >,
    openExternal: (url: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.appOpenExternal, url) as Promise<boolean>,
  },

  auth: {
    loginStart: (serverUrl, email, password) =>
      ipcRenderer.invoke(IPC_CHANNELS.authLoginStart, {
        serverUrl,
        email,
        password,
      }) as ReturnType<CodeVaultDesktopApi["auth"]["loginStart"]>,
    loginComplete: (totp) =>
      ipcRenderer.invoke(IPC_CHANNELS.authLoginComplete, {
        totp,
      }) as ReturnType<CodeVaultDesktopApi["auth"]["loginComplete"]>,
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.authLogout) as Promise<void>,
    restore: () =>
      ipcRenderer.invoke(IPC_CHANNELS.authRestore) as ReturnType<
        CodeVaultDesktopApi["auth"]["restore"]
      >,
    storageWarning: () =>
      ipcRenderer.invoke(IPC_CHANNELS.authStorageWarning) as Promise<
        string | null
      >,
  },

  invitation: {
    inspect: (serverUrl, token) =>
      ipcRenderer.invoke(IPC_CHANNELS.invitationInspect, {
        serverUrl,
        token,
      }) as ReturnType<CodeVaultDesktopApi["invitation"]["inspect"]>,
    start: (displayName, password) =>
      ipcRenderer.invoke(IPC_CHANNELS.invitationStart, {
        displayName,
        password,
      }) as ReturnType<CodeVaultDesktopApi["invitation"]["start"]>,
    confirm: (totp) =>
      ipcRenderer.invoke(IPC_CHANNELS.invitationConfirm, {
        totp,
      }) as ReturnType<CodeVaultDesktopApi["invitation"]["confirm"]>,
  },

  api: {
    request: <T>(path: string, options?: ApiRequestOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.apiRequest, {
        path,
        options: options ?? {},
      }) as Promise<ApiOutcome<T>>,
  },

  uploads: {
    select: () =>
      ipcRenderer.invoke(IPC_CHANNELS.uploadsSelect) as Promise<
        UploadSelection[]
      >,
    start: (request: StartUploadRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.uploadsStart, request) as Promise<
        ApiOutcome<string[]>
      >,
    onProgress: (listener) =>
      subscribe<UploadProgress>(IPC_CHANNELS.uploadsProgress, listener),
  },

  avatars: {
    selectAndUpload: (target) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.avatarsSelectAndUpload,
        target,
      ) as ReturnType<CodeVaultDesktopApi["avatars"]["selectAndUpload"]>,
    load: (avatarId) =>
      ipcRenderer.invoke(IPC_CHANNELS.avatarsLoad, avatarId) as ReturnType<
        CodeVaultDesktopApi["avatars"]["load"]
      >,
  },

  ai: {
    providers: () =>
      ipcRenderer.invoke(IPC_CHANNELS.aiProviders) as ReturnType<
        CodeVaultDesktopApi["ai"]["providers"]
      >,
    previewContext: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.aiPreviewContext, request) as ReturnType<
        CodeVaultDesktopApi["ai"]["previewContext"]
      >,
    run: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.aiRun, request) as ReturnType<
        CodeVaultDesktopApi["ai"]["run"]
      >,
    cancel: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.aiCancel, runId) as Promise<void>,
    onRunStateChange: (listener) =>
      subscribe(IPC_CHANNELS.aiRunState, listener),
  },

  events: {
    subscribe: (listener) => subscribe(IPC_CHANNELS.eventsMessage, listener),
    onConnectionChange: (listener) =>
      subscribe<boolean>(IPC_CHANNELS.eventsConnection, listener),
  },
};

contextBridge.exposeInMainWorld("codevault", api);
