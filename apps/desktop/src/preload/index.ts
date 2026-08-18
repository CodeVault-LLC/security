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
    login: (serverUrl, email, password) =>
      ipcRenderer.invoke(IPC_CHANNELS.authLogin, {
        serverUrl,
        email,
        password,
      }) as ReturnType<CodeVaultDesktopApi["auth"]["login"]>,
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

  submissions: {
    downloadManualBundle: (submissionId: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.submissionsDownloadManualBundle,
        submissionId,
      ) as ReturnType<
        CodeVaultDesktopApi["submissions"]["downloadManualBundle"]
      >,
    seal: (submissionId: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.submissionsSeal,
        submissionId,
      ) as ReturnType<CodeVaultDesktopApi["submissions"]["seal"]>,
    send: (submissionId: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.submissionsSend,
        submissionId,
      ) as ReturnType<CodeVaultDesktopApi["submissions"]["send"]>,
  },

  signingKeys: {
    list: () =>
      ipcRenderer.invoke(IPC_CHANNELS.signingKeysList) as ReturnType<
        CodeVaultDesktopApi["signingKeys"]["list"]
      >,
    import: (persist: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.signingKeysImport, persist) as ReturnType<
        CodeVaultDesktopApi["signingKeys"]["import"]
      >,
    remove: (fingerprint: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.signingKeysRemove,
        fingerprint,
      ) as ReturnType<CodeVaultDesktopApi["signingKeys"]["remove"]>,
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
