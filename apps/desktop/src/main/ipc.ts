import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { app, dialog, ipcMain, shell, type BrowserWindow } from "electron";

import type {
  AiContextPreview,
  AiRunWithProposals,
  ArtifactDownload,
  InviteInspection,
  LoginStartResponse,
  LoginResponse,
  WebAuthnCeremonyOptions,
  WebAuthnCredentialSummary,
  PreparedAiRun,
  RecoveryCodeBundle,
  TotpEnrollmentResponse,
  SubmissionPackage,
  SubmissionDelivery,
  SubmissionSendIntent,
  CorrespondenceDecryptIntent,
  SubmissionSealIntent,
  CaseArchiveSnapshot,
  PrepareCaseArchiveImportResult,
  ImportCaseArchiveResult,
  MailAttachmentDownload,
} from "@codevault/contracts";
import {
  previewFiles,
  previewFolder,
  readCvcase,
  writeCvcase,
  type CvcaseManifest,
} from "@codevault/exchange";

import {
  IPC_CHANNELS,
  type ApiOutcome,
  type ApiRequestOptions,
  type AuthResult,
  type StartUploadRequest,
} from "../preload/contracts.js";
import { ApiError, type ApiClient } from "./api-client.js";
import type { ProviderRegistry } from "./agents/registry.js";
import { DEFAULT_ENVIRONMENT_ALLOWLIST } from "./agents/types.js";
import {
  hashSelection,
  runUploads,
  type LocalUploadSelection,
} from "./file-uploads.js";
import { loadAvatarDataUrl, selectAndUploadAvatar } from "./avatar-uploads.js";
import { downloadFile, downloadVerifiedFile } from "./artifact-download.js";
import { buildAndSealManualPackage } from "./submissions/manual-package.js";
import { buildAndSealEmailPackage } from "./submissions/package-builder.js";
import type { SigningKeyStore } from "./crypto/signing-key-store.js";
import {
  decryptPgpMimeMessage,
  unlockPrivateKey,
} from "./crypto/openpgp-message.js";
import { promptPrivateKeyPassphrase } from "./crypto/passphrase-prompt.js";
import {
  isExternalUrlAllowed,
  isProtectedNativeOnlyApiPath,
  normalizeServerUrl,
} from "./security.js";
import type { SessionStore } from "./session-store.js";
import {
  UploadSelectionStore,
  UploadSelectionUnavailableError,
} from "./upload-selections.js";
import { runWebAuthnCeremony } from "./webauthn.js";

/**
 * IPC handlers.
 *
 * Every handler validates its sender before doing anything. Electron delivers
 * `invoke` calls from any frame in any window, so without that check a frame
 * loaded from somewhere unexpected could drive the main process.
 *
 * Handlers also never surface an exception to the renderer. Failures come back
 * as a typed outcome, because a rejected promise in the renderer becomes an
 * unhandled rejection carrying whatever the main process happened to include.
 */

export interface IpcDependencies {
  window: () => BrowserWindow | null;
  sessionStore: SessionStore;
  apiClient: ApiClient;
  providers: ProviderRegistry;
  signingKeys: SigningKeyStore;
  promptPassphrase?: (window: BrowserWindow) => Promise<string | null>;
  /** Cancels an in-flight AI run. */
  registerCancellation: (runId: string, controller: AbortController) => void;
  cancelRun: (runId: string) => void;
}

/**
 * Confirms an IPC message came from the application's own window.
 *
 * The check is on the sender's identity, not on a value the message carries —
 * anything in the payload is under the caller's control.
 */
function isTrustedSender(
  event: { senderFrame: { url: string } | null; sender: { id: number } },
  window: BrowserWindow | null,
): boolean {
  if (window === null || window.isDestroyed()) {
    return false;
  }

  if (event.sender.id !== window.webContents.id) {
    return false;
  }

  const frameUrl = event.senderFrame?.url ?? "";

  return (
    frameUrl.startsWith("codevault://app") ||
    frameUrl.startsWith("http://localhost:") ||
    frameUrl.startsWith("http://127.0.0.1:")
  );
}

function failure(error: unknown): ApiOutcome<never> {
  if (error instanceof ApiError) {
    return {
      ok: false,
      category: error.category,
      message: error.message,
      requestId: error.requestId,
      details: error.details,
    };
  }

  return {
    ok: false,
    category: "SERVER_ERROR",
    message: "Something went wrong on this workstation.",
    requestId: null,
    details: null,
  };
}

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  const { sessionStore, apiClient, providers, signingKeys } = dependencies;
  const promptPassphrase =
    dependencies.promptPassphrase ?? promptPrivateKeyPassphrase;
  let pendingLogin: {
    serverUrl: string;
    challengeToken: string;
    rememberMe: boolean;
  } | null = null;
  let pendingMigratedEnrollment: {
    serverUrl: string;
    enrollmentToken: string;
  } | null = null;
  let pendingInvitation: { serverUrl: string; token: string } | null = null;
  let pendingEnrollment: {
    serverUrl: string;
    enrollmentToken: string;
  } | null = null;
  const uploadSelections = new UploadSelectionStore();

  const approveServer = async (value: string): Promise<string | null> => {
    const serverUrl = normalizeServerUrl(value);
    if (serverUrl === null) return null;
    const confirmation = await dialog.showMessageBox(
      dependencies.window() ?? undefined!,
      {
        type: "question",
        buttons: ["Connect", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        title: "Connect to organization server",
        message: `Connect CodeVault Security to ${serverUrl}?`,
        detail:
          "Only approve the server address supplied by your organization administrator.",
        noLink: true,
      },
    );
    return confirmation.response === 0 ? serverUrl : null;
  };

  /** Registers a handler that refuses messages from an untrusted sender. */
  const handle = <T>(
    channel: string,
    handler: (payload: unknown) => Promise<T>,
  ): void => {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!isTrustedSender(event, dependencies.window())) {
        throw new Error("Rejected an IPC message from an untrusted sender.");
      }

      return handler(payload);
    });
  };

  handle(IPC_CHANNELS.appVersion, async () => app.getVersion());
  handle(IPC_CHANNELS.appPlatform, async () => process.platform);

  handle(IPC_CHANNELS.appOpenExternal, async (payload) => {
    if (typeof payload !== "string" || !isExternalUrlAllowed(payload)) {
      return false;
    }

    const window = dependencies.window();

    // Links inside research content point wherever the target's authors chose,
    // so opening one is always an explicit decision by the researcher.
    const confirmation = await dialog.showMessageBox(window ?? undefined!, {
      type: "question",
      buttons: ["Open link", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "Open an external link",
      message: "Open this link in your browser?",
      detail: payload,
      noLink: true,
    });

    if (confirmation.response !== 0) {
      return false;
    }

    await shell.openExternal(payload);

    return true;
  });

  handle(IPC_CHANNELS.authPreflight, async (payload) => {
    if (typeof payload !== "string") {
      return failure(new Error("invalid server address"));
    }

    try {
      const health = await apiClient.request<{
        status: "ok";
        apiVersion: string;
        serverVersion: string;
        webauthnOrigin?: string;
      }>("/health", {
        serverUrl: payload,
        anonymous: true,
      });
      return {
        ok: true as const,
        data: {
          ...health,
          compatible:
            health.apiVersion === "v1" &&
            typeof health.webauthnOrigin === "string" &&
            normalizeServerUrl(payload) === health.webauthnOrigin,
          compatibilityMessage:
            health.apiVersion !== "v1"
              ? `This desktop requires API v1. The server provides ${health.apiVersion}.`
              : typeof health.webauthnOrigin !== "string"
                ? "This server does not advertise WebAuthn security-key support."
                : normalizeServerUrl(payload) !== health.webauthnOrigin
                  ? `Use the server's configured WebAuthn origin: ${health.webauthnOrigin}`
                  : null,
        },
      };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.authLoginStart, async (payload) => {
    const request = payload as {
      serverUrl?: unknown;
      email?: unknown;
      password?: unknown;
      rememberMe?: unknown;
    };

    if (
      typeof request.serverUrl !== "string" ||
      typeof request.email !== "string" ||
      typeof request.password !== "string" ||
      typeof request.rememberMe !== "boolean"
    ) {
      return failure(new Error("invalid login payload"));
    }

    try {
      const serverUrl = await approveServer(request.serverUrl);
      if (serverUrl === null) {
        return failure(new Error("server connection was not approved"));
      }
      const response = await apiClient.request<LoginStartResponse>(
        "/v1/auth/login/start",
        {
          method: "POST",
          body: {
            email: request.email,
            password: request.password,
            rememberMe: request.rememberMe,
          },
          serverUrl,
          anonymous: true,
        },
      );
      if ("token" in response) {
        pendingLogin = null;
        uploadSelections.clear();
        const status = await sessionStore.save(
          {
            token: response.token,
            serverUrl,
            expiresAt: response.expiresAt,
            userId: response.user.id,
          },
          request.rememberMe,
        );
        const result: AuthResult = {
          user: response.user,
          persistent: request.rememberMe && status.persistent,
          storageWarning:
            !request.rememberMe || status.persistent
              ? null
              : "reason" in status
                ? status.reason
                : null,
        };
        return { ok: true as const, data: result };
      }
      pendingLogin = {
        serverUrl,
        challengeToken: response.challengeToken,
        rememberMe: request.rememberMe,
      };
      return {
        ok: true as const,
        data: {
          challenge: response.challenge,
          methods: response.methods,
          expiresAt: response.expiresAt,
        },
      };
    } catch (error: unknown) {
      pendingLogin = null;
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.authLoginComplete, async (payload) => {
    const request = payload as { totp?: unknown };
    if (
      pendingLogin === null ||
      typeof request.totp !== "string" ||
      !/^[0-9]{6}$/u.test(request.totp)
    ) {
      return failure(new Error("invalid MFA completion payload"));
    }
    try {
      const response = await apiClient.request<LoginResponse>(
        "/v1/auth/login/complete",
        {
          method: "POST",
          body: {
            challengeToken: pendingLogin.challengeToken,
            totp: request.totp,
            rememberMe: pendingLogin.rememberMe,
          },
          serverUrl: pendingLogin.serverUrl,
          anonymous: true,
        },
      );
      const serverUrl = pendingLogin.serverUrl;
      const rememberMe = pendingLogin.rememberMe;
      pendingLogin = null;
      uploadSelections.clear();
      const status = await sessionStore.save(
        {
          token: response.token,
          serverUrl,
          expiresAt: response.expiresAt,
          userId: response.user.id,
        },
        rememberMe,
      );
      const result: AuthResult = {
        user: response.user,
        persistent: rememberMe && status.persistent,
        storageWarning:
          !rememberMe || status.persistent
            ? null
            : "reason" in status
              ? status.reason
              : null,
      };
      return { ok: true as const, data: result };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.authLoginSecurityKey, async () => {
    if (pendingLogin === null) {
      return failure(new Error("missing login challenge"));
    }
    const parent = dependencies.window();
    if (parent === null)
      return failure(new Error("missing application window"));
    try {
      const started = await apiClient.request<WebAuthnCeremonyOptions>(
        "/v1/auth/webauthn/login/options",
        {
          method: "POST",
          body: { challengeToken: pendingLogin.challengeToken },
          serverUrl: pendingLogin.serverUrl,
          anonymous: true,
        },
      );
      const assertion = await runWebAuthnCeremony(
        parent,
        pendingLogin.serverUrl,
        "authenticate",
        started.options,
      );
      const response = await apiClient.request<LoginResponse>(
        "/v1/auth/webauthn/login/complete",
        {
          method: "POST",
          body: {
            ceremonyToken: started.ceremonyToken,
            response: assertion,
            rememberMe: pendingLogin.rememberMe,
          },
          serverUrl: pendingLogin.serverUrl,
          anonymous: true,
        },
      );
      const { serverUrl, rememberMe } = pendingLogin;
      pendingLogin = null;
      uploadSelections.clear();
      const status = await sessionStore.save(
        {
          token: response.token,
          serverUrl,
          expiresAt: response.expiresAt,
          userId: response.user.id,
        },
        rememberMe,
      );
      return {
        ok: true as const,
        data: {
          user: response.user,
          persistent: rememberMe && status.persistent,
          storageWarning:
            !rememberMe || status.persistent
              ? null
              : "reason" in status
                ? status.reason
                : null,
        },
      };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.authRegisterSecurityKey, async (payload) => {
    if (
      typeof payload !== "string" ||
      payload.trim().length === 0 ||
      payload.length > 120
    ) {
      return failure(new Error("invalid security-key name"));
    }
    const parent = dependencies.window();
    const serverUrl = apiClient.serverUrl();
    if (parent === null || serverUrl === null) {
      return failure(new Error("missing authenticated server"));
    }
    try {
      const started = await apiClient.request<WebAuthnCeremonyOptions>(
        "/v1/settings/security-keys/options",
        { method: "POST", body: { name: payload.trim() } },
      );
      const credential = await runWebAuthnCeremony(
        parent,
        serverUrl,
        "register",
        started.options,
      );
      const registered = await apiClient.request<WebAuthnCredentialSummary>(
        "/v1/settings/security-keys/complete",
        {
          method: "POST",
          body: {
            ceremonyToken: started.ceremonyToken,
            name: payload.trim(),
            response: credential,
          },
        },
      );
      return { ok: true as const, data: registered };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.authEnrollmentStart, async () => {
    if (pendingLogin === null) {
      return failure(new Error("missing migration enrollment challenge"));
    }
    try {
      const enrollment = await apiClient.request<TotpEnrollmentResponse>(
        "/v1/auth/enrollment/start",
        {
          method: "POST",
          body: { challengeToken: pendingLogin.challengeToken },
          serverUrl: pendingLogin.serverUrl,
          anonymous: true,
        },
      );
      pendingMigratedEnrollment = {
        serverUrl: pendingLogin.serverUrl,
        enrollmentToken: enrollment.enrollmentToken,
      };
      pendingLogin = null;
      return {
        ok: true as const,
        data: {
          provisioningUri: enrollment.provisioningUri,
          manualSecret: enrollment.manualSecret,
          expiresAt: enrollment.expiresAt,
        },
      };
    } catch (error) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.authEnrollmentConfirm, async (payload) => {
    const request = payload as { totp?: unknown };
    if (
      pendingMigratedEnrollment === null ||
      typeof request.totp !== "string" ||
      !/^[0-9]{6}$/u.test(request.totp)
    ) {
      return failure(new Error("invalid migration enrollment confirmation"));
    }
    try {
      const result = await apiClient.request<RecoveryCodeBundle>(
        "/v1/auth/enrollment/confirm",
        {
          method: "POST",
          body: {
            enrollmentToken: pendingMigratedEnrollment.enrollmentToken,
            totp: request.totp,
          },
          serverUrl: pendingMigratedEnrollment.serverUrl,
          anonymous: true,
        },
      );
      pendingMigratedEnrollment = null;
      return { ok: true as const, data: result };
    } catch (error) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.invitationInspect, async (payload) => {
    const request = payload as { serverUrl?: unknown; token?: unknown };
    if (
      typeof request.serverUrl !== "string" ||
      typeof request.token !== "string"
    )
      return failure(new Error("invalid invitation payload"));
    try {
      const serverUrl = await approveServer(request.serverUrl);
      if (serverUrl === null) {
        return failure(new Error("server connection was not approved"));
      }
      const inspection = await apiClient.request<InviteInspection>(
        "/v1/invitations/inspect",
        {
          method: "POST",
          body: { token: request.token },
          serverUrl,
          anonymous: true,
        },
      );
      pendingInvitation = {
        serverUrl,
        token: request.token,
      };
      pendingEnrollment = null;
      return { ok: true as const, data: inspection };
    } catch (error) {
      pendingInvitation = null;
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.invitationStart, async (payload) => {
    const request = payload as { displayName?: unknown; password?: unknown };
    if (
      pendingInvitation === null ||
      typeof request.displayName !== "string" ||
      typeof request.password !== "string"
    )
      return failure(new Error("invalid enrollment payload"));
    try {
      const enrollment = await apiClient.request<TotpEnrollmentResponse>(
        "/v1/invitations/enrollment/start",
        {
          method: "POST",
          body: {
            token: pendingInvitation.token,
            displayName: request.displayName,
            password: request.password,
          },
          serverUrl: pendingInvitation.serverUrl,
          anonymous: true,
        },
      );
      pendingEnrollment = {
        serverUrl: pendingInvitation.serverUrl,
        enrollmentToken: enrollment.enrollmentToken,
      };
      return {
        ok: true as const,
        data: {
          provisioningUri: enrollment.provisioningUri,
          manualSecret: enrollment.manualSecret,
          expiresAt: enrollment.expiresAt,
        },
      };
    } catch (error) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.invitationConfirm, async (payload) => {
    const request = payload as { totp?: unknown };
    if (
      pendingEnrollment === null ||
      typeof request.totp !== "string" ||
      !/^[0-9]{6}$/u.test(request.totp)
    )
      return failure(new Error("invalid enrollment confirmation"));
    try {
      const result = await apiClient.request<RecoveryCodeBundle>(
        "/v1/invitations/enrollment/confirm",
        {
          method: "POST",
          body: {
            enrollmentToken: pendingEnrollment.enrollmentToken,
            totp: request.totp,
          },
          serverUrl: pendingEnrollment.serverUrl,
          anonymous: true,
        },
      );
      pendingInvitation = null;
      pendingEnrollment = null;
      return { ok: true as const, data: result };
    } catch (error) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.authLogout, async () => {
    pendingLogin = null;
    pendingMigratedEnrollment = null;
    pendingInvitation = null;
    pendingEnrollment = null;
    uploadSelections.clear();
    // Start the authenticated request while the token is still available, then
    // synchronously invalidate the in-memory session before yielding. This
    // closes the window in which a file picker could mint a post-logout
    // capability while the network request is pending.
    const logoutRequest = apiClient
      .request("/v1/auth/logout", { method: "POST" })
      .catch(() => undefined);
    await sessionStore.clear();
    await logoutRequest;
  });

  handle(IPC_CHANNELS.authRestore, async () => {
    uploadSelections.clear();
    const restored = await sessionStore.restore();

    if (restored === null) {
      return null;
    }

    try {
      const me = await apiClient.request<{ user: AuthResult["user"] }>(
        "/v1/auth/me",
      );

      return {
        ok: true as const,
        data: {
          user: me.user,
          persistent: true,
          storageWarning: null,
        } satisfies AuthResult,
      };
    } catch (error: unknown) {
      await sessionStore.clear();

      return failure(error);
    }
  });

  handle(IPC_CHANNELS.authStorageWarning, async () => {
    const status = sessionStore.status();

    return status.persistent ? null : "reason" in status ? status.reason : null;
  });

  handle(IPC_CHANNELS.apiRequest, async (payload) => {
    const request = payload as { path?: unknown; options?: ApiRequestOptions };

    if (typeof request.path !== "string" || !request.path.startsWith("/v1/")) {
      // The renderer may only address the versioned API surface. It cannot ask
      // the main process to fetch an arbitrary path on the server host.
      return failure(new Error("invalid api path"));
    }
    if (isProtectedNativeOnlyApiPath(request.path)) {
      return failure(
        new ApiError(
          403,
          "PERMISSION_DENIED",
          "Sending requires the named native confirmation operation.",
          null,
          null,
        ),
      );
    }

    try {
      const data = await apiClient.request<unknown>(request.path, {
        method: request.options?.method ?? "GET",
        ...(request.options?.body === undefined
          ? {}
          : { body: request.options.body }),
      });

      return { ok: true as const, data };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.uploadsSelect, async () => {
    const window = dependencies.window();
    const owner = sessionStore.current();

    if (window === null || owner === null) {
      return [];
    }

    const selection = await dialog.showOpenDialog(window, {
      title: "Add evidence",
      properties: ["openFile", "multiSelections", "dontAddToRecent"],
    });

    if (selection.canceled) {
      return [];
    }

    const hashedSelections: Array<Omit<LocalUploadSelection, "selectionId">> =
      [];
    for (const path of selection.filePaths) {
      hashedSelections.push(await hashSelection(path));
    }
    const currentOwner = sessionStore.current();
    if (
      currentOwner === null ||
      currentOwner.userId !== owner.userId ||
      currentOwner.serverUrl !== owner.serverUrl ||
      currentOwner.token !== owner.token
    ) {
      return [];
    }

    const results: StartUploadRequest["selections"] = [];
    for (const hashed of hashedSelections) {
      const selected = uploadSelections.issue(hashed, owner);
      results.push({
        selectionId: selected.selectionId,
        filename: selected.filename,
        sizeBytes: selected.sizeBytes,
        mimeType: selected.mimeType,
        sha256: selected.sha256,
      });
    }

    return results;
  });

  handle(IPC_CHANNELS.intakeSelectFolder, async (payload) => {
    const context = payload as {
      findingTitles?: unknown;
      artifactDigests?: unknown;
    };
    if (
      !Array.isArray(context.findingTitles) ||
      context.findingTitles.length > 10_000 ||
      context.findingTitles.some((title) => typeof title !== "string") ||
      !Array.isArray(context.artifactDigests) ||
      context.artifactDigests.length > 100_000 ||
      context.artifactDigests.some(
        (digest) =>
          typeof digest !== "string" || !/^[0-9a-f]{64}$/u.test(digest),
      )
    ) {
      return failure(new Error("invalid folder intake context"));
    }
    const window = dependencies.window();
    const owner = sessionStore.current();
    if (window === null || owner === null) {
      return failure(new Error("folder intake is unavailable"));
    }
    const selection = await dialog.showOpenDialog(window, {
      title: "Select existing research folder",
      properties: ["openDirectory", "dontAddToRecent"],
    });
    if (selection.canceled || selection.filePaths[0] === undefined) {
      return { ok: true as const, data: null };
    }

    try {
      const root = resolve(selection.filePaths[0]);
      const preview = await previewFolder(root, {
        existingTitles: context.findingTitles,
        existingDigests: context.artifactDigests,
      });
      const currentOwner = sessionStore.current();
      if (
        currentOwner === null ||
        currentOwner.userId !== owner.userId ||
        currentOwner.serverUrl !== owner.serverUrl ||
        currentOwner.token !== owner.token
      ) {
        return failure(new Error("the session changed during folder intake"));
      }
      const selections = [];
      for (const file of preview.files) {
        const path = resolve(root, ...file.relativePath.split("/"));
        const pathFromRoot = relative(root, path);
        if (
          pathFromRoot === ".." ||
          pathFromRoot.startsWith("../") ||
          pathFromRoot.startsWith("..\\") ||
          isAbsolute(pathFromRoot)
        ) {
          return failure(new Error("folder intake produced an unsafe path"));
        }
        const selected = uploadSelections.issue(
          await hashSelection(path),
          owner,
        );
        selections.push({
          selectionId: selected.selectionId,
          filename: selected.filename,
          sizeBytes: selected.sizeBytes,
          mimeType: selected.mimeType,
          sha256: selected.sha256,
          relativePath: file.relativePath,
          disposition: file.disposition,
        });
      }
      return { ok: true as const, data: { ...preview, selections } };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.intakePreviewFiles, async (payload) => {
    const request = payload as {
      context?: {
        findingTitles?: unknown;
        artifactDigests?: unknown;
      };
      paths?: unknown;
    };
    const context = request.context;
    if (
      context === undefined ||
      !Array.isArray(context.findingTitles) ||
      context.findingTitles.length > 10_000 ||
      context.findingTitles.some((title) => typeof title !== "string") ||
      !Array.isArray(context.artifactDigests) ||
      context.artifactDigests.length > 100_000 ||
      context.artifactDigests.some(
        (digest) =>
          typeof digest !== "string" || !/^[0-9a-f]{64}$/u.test(digest),
      ) ||
      !Array.isArray(request.paths) ||
      request.paths.length === 0 ||
      request.paths.length > 500 ||
      request.paths.some((path) => typeof path !== "string" || path === "")
    ) {
      return failure(new Error("invalid finding file preview request"));
    }
    const owner = sessionStore.current();
    if (owner === null) {
      return failure(new Error("finding file preview is unavailable"));
    }

    try {
      const result = await previewFiles(request.paths as string[], {
        existingTitles: context.findingTitles,
        existingDigests: context.artifactDigests,
        maxFiles: 500,
      });
      const currentOwner = sessionStore.current();
      if (
        currentOwner === null ||
        currentOwner.userId !== owner.userId ||
        currentOwner.serverUrl !== owner.serverUrl ||
        currentOwner.token !== owner.token
      ) {
        return failure(
          new Error("the session changed during finding file preview"),
        );
      }
      const selections = [];
      for (const file of result.preview.files) {
        const source = result.sources.find(
          (candidate) => candidate.relativePath === file.relativePath,
        );
        if (source === undefined) {
          return failure(new Error("finding file preview lost its source"));
        }
        const selected = uploadSelections.issue(
          await hashSelection(source.absolutePath),
          owner,
        );
        selections.push({
          selectionId: selected.selectionId,
          filename: selected.filename,
          sizeBytes: selected.sizeBytes,
          mimeType: selected.mimeType,
          sha256: selected.sha256,
          relativePath: file.relativePath,
          disposition: file.disposition,
        });
      }
      return {
        ok: true as const,
        data: { ...result.preview, selections },
      };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.caseArchivesExport, async (payload) => {
    if (typeof payload !== "string" || !/^[0-9a-f-]{36}$/iu.test(payload)) {
      return failure(new Error("invalid case archive export request"));
    }
    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));
    const destination = await dialog.showSaveDialog(window, {
      title: "Export complete case archive",
      defaultPath: `codevault-case-${payload.slice(0, 8)}.cvcase`,
      filters: [{ name: "CodeVault case archive", extensions: ["cvcase"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (destination.canceled || destination.filePath === undefined) {
      return { ok: true as const, data: { saved: false, sha256: null } };
    }
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "codevault-case-export-"),
    );
    try {
      const snapshot = await apiClient.request<CaseArchiveSnapshot>(
        `/v1/cases/${payload}/archive-snapshot`,
      );
      const sources: Array<{ sourceId: string; path: string }> = [];
      for (const artifact of snapshot.artifacts) {
        const path = join(temporaryDirectory, artifact.sourceId);
        await downloadFile(artifact.url, path);
        const selected = await hashSelection(path);
        if (
          selected.sizeBytes !== artifact.sizeBytes ||
          selected.sha256 !== artifact.sha256
        ) {
          throw new Error(
            `Downloaded artifact ${artifact.filename} failed verification.`,
          );
        }
        sources.push({ sourceId: artifact.sourceId, path });
      }
      await writeCvcase(destination.filePath, {
        manifest: desktopArchiveManifest(snapshot.manifest),
        records: snapshot.records,
        artifacts: sources,
        overwriteExisting: true,
      });
      const archive = await hashSelection(destination.filePath);
      return {
        ok: true as const,
        data: { saved: true, sha256: archive.sha256 },
      };
    } catch (error: unknown) {
      return failure(error);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  handle(IPC_CHANNELS.caseArchivesImport, async () => {
    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));
    const selection = await dialog.showOpenDialog(window, {
      title: "Import complete case archive",
      filters: [{ name: "CodeVault case archive", extensions: ["cvcase"] }],
      properties: ["openFile", "dontAddToRecent"],
    });
    const archivePath = selection.filePaths[0];
    if (selection.canceled || archivePath === undefined) {
      return { ok: true as const, data: null };
    }
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "codevault-case-import-"),
    );
    let importId: string | null = null;
    try {
      const extracted = await readCvcase(
        archivePath,
        join(temporaryDirectory, "verified"),
      );
      const confirmation = await dialog.showMessageBox(window, {
        type: "question",
        title: "Import case archive",
        message: `Import ${extracted.manifest.case.title}?`,
        detail: `${Object.values(extracted.manifest.recordCounts).reduce((sum, count) => sum + count, 0)} records and ${extracted.manifest.artifacts.length} artifacts will be added as a new case. The import is all-or-nothing.`,
        buttons: ["Import case", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (confirmation.response !== 0) {
        return { ok: true as const, data: null };
      }
      const prepared = await apiClient.request<PrepareCaseArchiveImportResult>(
        "/v1/case-archives/imports",
        {
          method: "POST",
          body: {
            manifest: { ...extracted.manifest },
            records: extracted.records,
          },
        },
      );
      importId = prepared.importId;
      const localById = new Map(
        extracted.artifacts.map((artifact) => [artifact.sourceId, artifact]),
      );
      const completions: Array<{
        sourceId: string;
        parts: Array<{ partNumber: number; etag: string }>;
      }> = [];
      for (const upload of prepared.uploads) {
        const local = localById.get(upload.sourceId);
        if (local === undefined) {
          throw new Error(
            `The archive is missing artifact ${upload.sourceId}.`,
          );
        }
        completions.push({
          sourceId: upload.sourceId,
          parts: await uploadArchiveArtifact(
            local.path,
            local.sizeBytes,
            upload,
          ),
        });
      }
      const result = await apiClient.request<ImportCaseArchiveResult>(
        `/v1/case-archives/imports/${prepared.importId}/commit`,
        { method: "POST", body: { uploads: completions } },
      );
      importId = null;
      return { ok: true as const, data: result };
    } catch (error: unknown) {
      if (importId !== null) {
        await apiClient
          .request(`/v1/case-archives/imports/${importId}`, {
            method: "DELETE",
          })
          .catch(() => undefined);
      }
      return failure(error);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  handle(IPC_CHANNELS.reportsDownloadExport, async (payload) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("artifactId" in payload) ||
      typeof payload.artifactId !== "string" ||
      !/^[0-9a-f-]{36}$/iu.test(payload.artifactId) ||
      !("format" in payload) ||
      (payload.format !== "PDF" && payload.format !== "MARKDOWN")
    ) {
      return failure(new Error("invalid report download request"));
    }

    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));

    try {
      const artifact = await apiClient.request<ArtifactDownload>(
        `/v1/artifacts/${payload.artifactId}`,
      );
      const filename = safeReportExportFilename(
        artifact.filename,
        payload.format,
      );
      const markdown = payload.format === "MARKDOWN";
      const destination = await dialog.showSaveDialog(window, {
        title: markdown ? "Save report Markdown" : "Save report PDF",
        defaultPath: filename,
        filters: [
          markdown
            ? { name: "Markdown document", extensions: ["md"] }
            : { name: "PDF document", extensions: ["pdf"] },
        ],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });

      if (destination.canceled || destination.filePath === undefined) {
        return { ok: true as const, data: { saved: false, sha256: null } };
      }

      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), "codevault-report-download-"),
      );
      const temporaryPath = join(temporaryDirectory, filename);

      try {
        await downloadVerifiedFile(
          artifact.url,
          temporaryPath,
          artifact.sha256,
        );
        await copyFile(temporaryPath, destination.filePath);

        return {
          ok: true as const,
          data: { saved: true, sha256: artifact.sha256 },
        };
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.mailDownloadAttachment, async (payload) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("connectionId" in payload) ||
      typeof payload.connectionId !== "string" ||
      !/^[0-9a-f-]{36}$/iu.test(payload.connectionId) ||
      !("messageId" in payload) ||
      typeof payload.messageId !== "string" ||
      !/^[A-Za-z0-9_-]{1,500}$/.test(payload.messageId) ||
      !("attachmentIndex" in payload) ||
      typeof payload.attachmentIndex !== "number" ||
      !Number.isInteger(payload.attachmentIndex) ||
      Number(payload.attachmentIndex) < 0 ||
      Number(payload.attachmentIndex) > 99
    ) {
      return failure(new Error("invalid mail attachment download request"));
    }

    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));

    try {
      const attachment = await apiClient.request<MailAttachmentDownload>(
        `/v1/mail/connections/${payload.connectionId}/messages/${payload.messageId}/attachments/${payload.attachmentIndex}`,
      );
      const safeFilename = attachment.filename
        .replaceAll("\\", "/")
        .split("/")
        .at(-1)
        // eslint-disable-next-line no-control-regex -- MIME filenames are untrusted input
        ?.replace(/[\u0000-\u001f\u007f]/g, "_");
      if (safeFilename === undefined || safeFilename.length === 0) {
        throw new Error("mail attachment has an invalid filename");
      }
      const bytes = Buffer.from(attachment.base64, "base64");
      if (bytes.byteLength !== attachment.sizeBytes) {
        throw new Error("mail attachment failed size verification");
      }
      const destination = await dialog.showSaveDialog(window, {
        title: "Save mail attachment",
        defaultPath: safeFilename,
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (destination.canceled || destination.filePath === undefined) {
        return { ok: true as const, data: { saved: false } };
      }
      await writeFile(destination.filePath, bytes, { mode: 0o600 });
      return { ok: true as const, data: { saved: true } };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.avatarsSelectAndUpload, async (payload) => {
    if (payload !== "USER" && payload !== "ORGANIZATION")
      return failure(new Error("invalid avatar target"));
    const window = dependencies.window();
    if (!window) return failure(new Error("window unavailable"));
    try {
      const result = await selectAndUploadAvatar({
        window,
        target: payload,
        apiClient,
        sessionStore,
      });
      return { ok: true as const, data: result };
    } catch (error) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.avatarsLoad, async (payload) => {
    if (typeof payload !== "string" || !/^[0-9a-f-]{36}$/u.test(payload))
      return failure(new Error("invalid avatar id"));
    try {
      return {
        ok: true as const,
        data: await loadAvatarDataUrl(sessionStore, payload),
      };
    } catch (error) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.avatarsLoadUser, async (payload) => {
    if (typeof payload !== "string" || !/^[0-9a-f-]{36}$/u.test(payload))
      return failure(new Error("invalid user id"));
    try {
      return {
        ok: true as const,
        data: await loadAvatarDataUrl(sessionStore, payload, "USER"),
      };
    } catch (error) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.uploadsStart, async (payload) => {
    const window = dependencies.window();

    try {
      const request = payload as Partial<StartUploadRequest>;
      if (
        typeof request.caseId !== "string" ||
        (request.findingId !== undefined &&
          typeof request.findingId !== "string") ||
        typeof request.artifactKind !== "string" ||
        !["INTERNAL", "VENDOR", "PUBLIC"].includes(
          request.visibility as string,
        ) ||
        !Array.isArray(request.selections) ||
        request.selections.length === 0
      ) {
        return failure(new Error("invalid upload request"));
      }
      const selectionIds: string[] = [];
      for (const item of request.selections) {
        if (
          typeof item !== "object" ||
          item === null ||
          typeof item.selectionId !== "string"
        ) {
          return failure(new Error("invalid upload selection"));
        }
        selectionIds.push(item.selectionId);
      }
      const owner = sessionStore.current();
      if (owner === null) return failure(new Error("missing upload session"));
      const resolved = uploadSelections.resolve(selectionIds, owner);
      const result = await runUploads({
        request: {
          caseId: request.caseId,
          ...(request.findingId === undefined
            ? {}
            : { findingId: request.findingId }),
          artifactKind: request.artifactKind,
          visibility: request.visibility as "INTERNAL" | "VENDOR" | "PUBLIC",
          selections: resolved,
        },
        apiClient,
        onProgress: (progress) => {
          window?.webContents.send(IPC_CHANNELS.uploadsProgress, progress);
        },
      });

      const completedSelectionIds = result.items
        .filter((item) => item.artifactId !== null)
        .map((item) => item.selectionId);
      if (completedSelectionIds.length > 0) {
        uploadSelections.consume(completedSelectionIds, owner);
      }

      return { ok: true as const, data: result };
    } catch (error: unknown) {
      if (error instanceof UploadSelectionUnavailableError) {
        return {
          ok: false as const,
          category: "VALIDATION",
          message:
            "The local file selection expired or belongs to an earlier desktop session.",
          requestId: null,
          details: { code: "UPLOAD_SELECTION_UNAVAILABLE" },
        };
      }
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.uploadsValidateSelections, async (payload) => {
    if (
      !Array.isArray(payload) ||
      payload.length === 0 ||
      payload.length > 5_000 ||
      payload.some(
        (selectionId) =>
          typeof selectionId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(selectionId),
      )
    ) {
      return failure(new Error("invalid upload selection validation request"));
    }
    const owner = sessionStore.current();
    if (owner === null) return failure(new Error("missing upload session"));
    return {
      ok: true as const,
      data: { available: uploadSelections.areAvailable(payload, owner) },
    };
  });

  handle(IPC_CHANNELS.uploadsDiscard, async (payload) => {
    if (
      !Array.isArray(payload) ||
      payload.length === 0 ||
      payload.some(
        (item) =>
          typeof item !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(item),
      )
    ) {
      return failure(new Error("invalid artifact cleanup request"));
    }

    try {
      for (const artifactId of [...new Set(payload)]) {
        await apiClient.request(`/v1/artifacts/${artifactId}`, {
          method: "DELETE",
        });
      }
      return { ok: true as const, data: { ok: true as const } };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.submissionsDownloadManualBundle, async (payload) => {
    if (
      typeof payload !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        payload,
      )
    ) {
      return failure(new Error("invalid submission id"));
    }

    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));

    const destination = await dialog.showSaveDialog(window, {
      title: "Save sealed manual submission",
      defaultPath: `codevault-submission-${payload.slice(0, 8)}.zip`,
      filters: [{ name: "ZIP archive", extensions: ["zip"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (destination.canceled || destination.filePath === undefined) {
      return {
        ok: true as const,
        data: { saved: false, packageId: null, sha256: null },
      };
    }

    try {
      const intent = await apiClient.request<SubmissionSealIntent>(
        `/v1/submissions/${payload}/seal-intent`,
        { method: "POST" },
      );
      const result = await buildAndSealManualPackage({
        intent,
        fetchImpl: async (url, init) =>
          fetch(url, {
            ...(init?.method === undefined ? {} : { method: init.method }),
            ...(init?.headers === undefined ? {} : { headers: init.headers }),
            ...(init?.body === undefined
              ? {}
              : { body: Buffer.from(init.body) }),
          }),
        beforeUpload: async (bytes) => {
          await writeFile(destination.filePath!, bytes, { mode: 0o600 });
        },
        complete: (body) =>
          apiClient.request<SubmissionPackage>(
            `/v1/submissions/${payload}/seal`,
            { method: "POST", body },
          ),
      });
      return {
        ok: true as const,
        data: {
          saved: true,
          packageId: result.packageId,
          sha256: result.sha256,
        },
      };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.signingKeysList, async () => signingKeys.list());

  handle(IPC_CHANNELS.signingKeysImport, async (payload) => {
    if (typeof payload !== "boolean")
      return failure(new Error("invalid persistence choice"));
    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));
    const selection = await dialog.showOpenDialog(window, {
      title: "Import OpenPGP private signing key",
      properties: ["openFile", "dontAddToRecent"],
      filters: [
        { name: "Armored OpenPGP key", extensions: ["asc", "pgp", "key"] },
      ],
    });
    const path = selection.filePaths[0];
    if (selection.canceled || path === undefined)
      return { ok: true as const, data: null };
    try {
      const info = await stat(path);
      if (info.size > 2_000_000) throw new Error("key file too large");
      const summary = await signingKeys.importArmored(
        await readFile(path, "utf8"),
        payload,
      );
      return { ok: true as const, data: summary };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.signingKeysRemove, async (payload) => {
    if (
      typeof payload !== "string" ||
      !/^(?:[0-9A-F]{40}|[0-9A-F]{64})$/i.test(payload)
    ) {
      return failure(new Error("invalid fingerprint"));
    }
    try {
      await signingKeys.remove(payload);
      return { ok: true as const, data: { ok: true as const } };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.submissionsSeal, async (payload) => {
    if (
      typeof payload !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload)
    ) {
      return failure(new Error("invalid submission id"));
    }
    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));
    try {
      const intent = await apiClient.request<SubmissionSealIntent>(
        `/v1/submissions/${payload}/seal-intent`,
        { method: "POST" },
      );
      const route = intent.manifest.routeSnapshot.route;
      if (route.type !== "EMAIL" || intent.senderAddress === null) {
        throw new Error(
          "Select an active sending mailbox before sealing email.",
        );
      }
      let signingPrivateKey: string | null = null;
      let unlockedSigningPrivateKey: Awaited<
        ReturnType<typeof unlockPrivateKey>
      > | null = null;
      if (intent.cryptoMode === "SIGNED_AND_ENCRYPTED") {
        const keys = await signingKeys.list();
        if (keys.length !== 1)
          throw new Error("Select exactly one local signing key.");
        signingPrivateKey =
          (await signingKeys.armored(keys[0]!.fingerprint)) ?? null;
        if (signingPrivateKey === null)
          throw new Error("The selected signing key is unavailable.");
        if (keys[0]!.encrypted) {
          const passphrase = await promptPassphrase(window);
          if (passphrase === null) throw new Error("Key unlock cancelled.");
          unlockedSigningPrivateKey = await unlockPrivateKey(
            signingPrivateKey,
            passphrase,
          );
        }
      }
      const messageId = `<${randomUUID()}@codevault.local>`;
      const result = await buildAndSealEmailPackage({
        intent,
        senderAddress: intent.senderAddress,
        messageId,
        signingPrivateKey: unlockedSigningPrivateKey ?? signingPrivateKey,
        fetchImpl: async (url, init) =>
          fetch(url, {
            ...(init?.method === undefined ? {} : { method: init.method }),
            ...(init?.headers === undefined ? {} : { headers: init.headers }),
            ...(init?.body === undefined
              ? {}
              : { body: Buffer.from(init.body) }),
          }),
        confirm: async (summary) => {
          const confirmation = await dialog.showMessageBox(window, {
            type: "warning",
            buttons: ["Seal exact message", "Cancel"],
            defaultId: 1,
            cancelId: 1,
            title: "Seal vendor email",
            message: "Seal this exact email package?",
            detail: `From: ${intent.senderAddress}\nTo: ${route.to.join(", ")}\nCC: ${route.cc.join(", ") || "none"}\nSubject: ${intent.subject}\nCrypto: ${intent.cryptoMode}\nAttachments: ${intent.attachments.length}\nSHA-256: ${summary.sha256}`,
            noLink: true,
          });
          return confirmation.response === 0;
        },
        complete: (body) =>
          apiClient.request<SubmissionPackage>(
            `/v1/submissions/${payload}/seal`,
            { method: "POST", body },
          ),
      });
      return {
        ok: true as const,
        data: {
          saved: true,
          packageId: result.packageId,
          sha256: result.sha256,
        },
      };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.submissionsSend, async (payload) => {
    if (
      typeof payload !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload)
    ) {
      return failure(new Error("invalid submission id"));
    }
    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));
    try {
      const intent = await apiClient.request<SubmissionSendIntent>(
        `/v1/submissions/${payload}/send-intent`,
      );
      const attachmentSummary =
        intent.attachments.length === 0
          ? "none"
          : intent.attachments
              .map(
                (item) =>
                  `${item.filename} (${item.sizeBytes} bytes, SHA-256 ${item.sha256})`,
              )
              .join("\n");
      const confirmation = await dialog.showMessageBox(window, {
        type: "warning",
        buttons: ["Send now", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        title: "Send vendor email",
        message: "Send this exact sealed email now? This cannot be undone.",
        detail: `From: ${intent.from}\nTo: ${intent.to.join(", ")}\nCC: ${intent.cc.join(", ") || "none"}\nSubject (not encrypted): ${intent.subject}\n\nBody:\n${intent.bodyText}\n\nBody SHA-256: ${intent.bodyUtf8Sha256}\nCrypto: ${intent.cryptoMode}\nRecipient key: ${intent.publicKeyFingerprint ?? "none"}\nPackage: ${intent.packageSizeBytes} bytes, SHA-256 ${intent.packageSha256}\nMessage-ID: ${intent.rfcMessageId}\nAttachments:\n${attachmentSummary}`,
        noLink: true,
      });
      if (confirmation.response !== 0) {
        return failure(
          new ApiError(400, "VALIDATION", "Send cancelled.", null, null),
        );
      }
      const delivery = await apiClient.request<SubmissionDelivery>(
        `/v1/submissions/${payload}/send`,
        { method: "POST" },
      );
      return { ok: true as const, data: delivery };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.correspondenceDecrypt, async (payload) => {
    if (
      typeof payload !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload)
    ) {
      return failure(new Error("invalid correspondence id"));
    }
    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));
    try {
      const intent = await apiClient.request<CorrespondenceDecryptIntent>(
        `/v1/correspondence/${payload}/decrypt-intent`,
      );
      const confirmation = await dialog.showMessageBox(window, {
        type: "warning",
        buttons: ["Decrypt locally", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        title: "Decrypt vendor correspondence",
        message: "Decrypt this message on this workstation?",
        detail: `From: ${intent.from}\nSubject (not encrypted): ${intent.subject}\n\nPlaintext will be shown in the app temporarily. It is not saved unless you explicitly save the reviewed plaintext to the case.`,
        noLink: true,
      });
      if (confirmation.response !== 0) {
        return failure(
          new ApiError(400, "VALIDATION", "Decryption cancelled.", null, null),
        );
      }
      const keys = await signingKeys.list();
      if (keys.length !== 1)
        throw new Error("Select exactly one local private key.");
      const armoredKey = await signingKeys.armored(keys[0]!.fingerprint);
      if (armoredKey === null)
        throw new Error("The selected private key is unavailable.");
      let privateKey: string | Awaited<ReturnType<typeof unlockPrivateKey>> =
        armoredKey;
      if (keys[0]!.encrypted) {
        const passphrase = await promptPassphrase(window);
        if (passphrase === null) throw new Error("Key unlock cancelled.");
        privateKey = await unlockPrivateKey(armoredKey, passphrase);
      }
      const response = await fetch(intent.downloadUrl, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error("The encrypted message could not be downloaded.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (
        bytes.byteLength !== intent.sizeBytes ||
        createHash("sha256").update(bytes).digest("hex") !== intent.sha256
      ) {
        throw new Error(
          "The encrypted message failed its digest or size check.",
        );
      }
      const opened = await decryptPgpMimeMessage(bytes, privateKey);
      return {
        ok: true as const,
        data: { messageId: payload, ...opened },
      };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.correspondenceExportTranscript, async (payload) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("submissionId" in payload) ||
      typeof payload.submissionId !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
        payload.submissionId,
      ) ||
      !("markdown" in payload) ||
      typeof payload.markdown !== "string" ||
      payload.markdown.length === 0 ||
      payload.markdown.length > 10_000_000
    ) {
      return failure(new Error("invalid correspondence transcript"));
    }
    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));

    try {
      const filename = `correspondence-${payload.submissionId.slice(0, 8)}.md`;
      const destination = await dialog.showSaveDialog(window, {
        title: "Save correspondence transcript",
        defaultPath: filename,
        filters: [{ name: "Markdown document", extensions: ["md"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (destination.canceled || destination.filePath === undefined) {
        return { ok: true as const, data: { saved: false, sha256: null } };
      }

      const bytes = new TextEncoder().encode(payload.markdown);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), "codevault-correspondence-export-"),
      );
      const temporaryPath = join(temporaryDirectory, filename);
      try {
        await writeFile(temporaryPath, bytes, { flag: "wx" });
        await copyFile(temporaryPath, destination.filePath);
        return { ok: true as const, data: { saved: true, sha256 } };
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.auditSaveCsv, async (payload) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("caseId" in payload) ||
      typeof payload.caseId !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(payload.caseId) ||
      !("csv" in payload) ||
      typeof payload.csv !== "string" ||
      payload.csv.length === 0 ||
      payload.csv.length > 10_000_000
    ) {
      return failure(new Error("invalid audit CSV export"));
    }
    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));

    try {
      const filename = `case-${payload.caseId.slice(0, 8)}-activity.csv`;
      const destination = await dialog.showSaveDialog(window, {
        title: "Save case activity CSV",
        defaultPath: filename,
        filters: [{ name: "CSV document", extensions: ["csv"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (destination.canceled || destination.filePath === undefined) {
        return { ok: true as const, data: { saved: false, sha256: null } };
      }

      const bytes = new TextEncoder().encode(payload.csv);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), "codevault-audit-export-"),
      );
      const temporaryPath = join(temporaryDirectory, filename);
      try {
        await writeFile(temporaryPath, bytes, { flag: "wx" });
        await copyFile(temporaryPath, destination.filePath);
        return { ok: true as const, data: { saved: true, sha256 } };
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.caseHandoffSaveBrief, async (payload) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("caseId" in payload) ||
      typeof payload.caseId !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(payload.caseId) ||
      !("markdown" in payload) ||
      typeof payload.markdown !== "string" ||
      payload.markdown.length === 0 ||
      payload.markdown.length > 10_000_000
    ) {
      return failure(new Error("invalid case handoff brief"));
    }
    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));

    try {
      const filename = `case-${payload.caseId.slice(0, 8)}-handoff.md`;
      const destination = await dialog.showSaveDialog(window, {
        title: "Save case handoff brief",
        defaultPath: filename,
        filters: [{ name: "Markdown document", extensions: ["md"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (destination.canceled || destination.filePath === undefined) {
        return { ok: true as const, data: { saved: false, sha256: null } };
      }

      const bytes = new TextEncoder().encode(payload.markdown);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), "codevault-case-handoff-export-"),
      );
      const temporaryPath = join(temporaryDirectory, filename);
      try {
        await writeFile(temporaryPath, bytes, { flag: "wx" });
        await copyFile(temporaryPath, destination.filePath);
        return { ok: true as const, data: { saved: true, sha256 } };
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.publicAdvisorySave, async (payload) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("findingId" in payload) ||
      typeof payload.findingId !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(
        payload.findingId,
      ) ||
      !("markdown" in payload) ||
      typeof payload.markdown !== "string" ||
      payload.markdown.length === 0 ||
      payload.markdown.length > 10_000_000
    ) {
      return failure(new Error("invalid public advisory"));
    }
    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));
    try {
      const filename = `security-advisory-${payload.findingId.slice(0, 8)}.md`;
      const destination = await dialog.showSaveDialog(window, {
        title: "Save public security advisory",
        defaultPath: filename,
        filters: [{ name: "Markdown document", extensions: ["md"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (destination.canceled || destination.filePath === undefined) {
        return { ok: true as const, data: { saved: false, sha256: null } };
      }
      const bytes = new TextEncoder().encode(payload.markdown);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), "codevault-public-advisory-"),
      );
      const temporaryPath = join(temporaryDirectory, filename);
      try {
        await writeFile(temporaryPath, bytes, { flag: "wx" });
        await copyFile(temporaryPath, destination.filePath);
        return { ok: true as const, data: { saved: true, sha256 } };
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.evidenceSaveManifest, async (payload) => {
    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("caseId" in payload) ||
      typeof payload.caseId !== "string" ||
      !uuid.test(payload.caseId) ||
      !("findingId" in payload) ||
      (payload.findingId !== null &&
        (typeof payload.findingId !== "string" ||
          !uuid.test(payload.findingId))) ||
      !("json" in payload) ||
      typeof payload.json !== "string" ||
      payload.json.length === 0 ||
      payload.json.length > 10_000_000
    ) {
      return failure(new Error("invalid evidence manifest export"));
    }
    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));

    try {
      const parsed = JSON.parse(payload.json) as {
        format?: unknown;
        version?: unknown;
        scope?: { caseId?: unknown; findingId?: unknown };
      };
      if (
        parsed.format !== "codevault.evidence-manifest" ||
        parsed.version !== 1 ||
        parsed.scope?.caseId !== payload.caseId ||
        parsed.scope.findingId !== payload.findingId
      ) {
        throw new Error("evidence manifest scope does not match the request");
      }

      const scope =
        payload.findingId === null
          ? `case-${payload.caseId.slice(0, 8)}`
          : `finding-${payload.findingId.slice(0, 8)}`;
      const filename = `${scope}-evidence-manifest.json`;
      const destination = await dialog.showSaveDialog(window, {
        title: "Save evidence manifest",
        defaultPath: filename,
        filters: [{ name: "JSON document", extensions: ["json"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (destination.canceled || destination.filePath === undefined) {
        return { ok: true as const, data: { saved: false, sha256: null } };
      }

      const bytes = new TextEncoder().encode(payload.json);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), "codevault-evidence-manifest-"),
      );
      const temporaryPath = join(temporaryDirectory, filename);
      try {
        await writeFile(temporaryPath, bytes, { flag: "wx" });
        await copyFile(temporaryPath, destination.filePath);
        return { ok: true as const, data: { saved: true, sha256 } };
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.disclosureSaveCalendar, async (payload) => {
    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("caseId" in payload) ||
      typeof payload.caseId !== "string" ||
      !uuid.test(payload.caseId) ||
      !("ics" in payload) ||
      typeof payload.ics !== "string" ||
      payload.ics.length === 0 ||
      payload.ics.length > 1_000_000 ||
      !payload.ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n") ||
      !payload.ics.endsWith("END:VCALENDAR\r\n") ||
      !payload.ics.includes(`${payload.caseId}@codevault.local`)
    ) {
      return failure(new Error("invalid disclosure calendar export"));
    }
    const window = dependencies.window();
    if (window === null) return failure(new Error("window unavailable"));

    try {
      const filename = `case-${payload.caseId.slice(0, 8)}-disclosure.ics`;
      const destination = await dialog.showSaveDialog(window, {
        title: "Save disclosure calendar",
        defaultPath: filename,
        filters: [{ name: "iCalendar", extensions: ["ics"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (destination.canceled || destination.filePath === undefined) {
        return { ok: true as const, data: { saved: false, sha256: null } };
      }

      const bytes = new TextEncoder().encode(payload.ics);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), "codevault-disclosure-calendar-"),
      );
      const temporaryPath = join(temporaryDirectory, filename);
      try {
        await writeFile(temporaryPath, bytes, { flag: "wx" });
        await copyFile(temporaryPath, destination.filePath);
        return { ok: true as const, data: { saved: true, sha256 } };
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    } catch (error: unknown) {
      return failure(error);
    }
  });

  handle(IPC_CHANNELS.aiProviders, async () => providers.statuses());

  handle(IPC_CHANNELS.aiPreviewContext, async (payload) => {
    try {
      const data = await apiClient.request<AiContextPreview>(
        "/v1/ai/context-preview",
        { method: "POST", body: payload },
      );

      return { ok: true as const, data };
    } catch (error: unknown) {
      return failure(error);
    }
  });

  /**
   * Runs an AI action.
   *
   * Three steps, in this order: the server builds and filters the context and
   * returns a prompt; the local provider executes it; the output goes back to
   * the server for schema validation. The renderer supplies an action ID and a
   * target, and nothing else.
   */
  handle(IPC_CHANNELS.aiRun, async (payload) => {
    const request = payload as {
      action?: unknown;
      targetType?: unknown;
      targetId?: unknown;
      instruction?: unknown;
      providerId?: unknown;
      model?: unknown;
      effort?: unknown;
    };

    const providerId =
      typeof request.providerId === "string"
        ? request.providerId
        : "claude-code";
    const provider = providers.get(providerId);

    if (provider === null) {
      return failure(
        new ApiError(
          0,
          "PROVIDER_UNAVAILABLE",
          `No local provider named "${providerId}" is registered.`,
          null,
          null,
        ),
      );
    }

    const detection = await provider.detect();

    if (!detection.available) {
      return failure(
        new ApiError(
          0,
          "PROVIDER_UNAVAILABLE",
          detection.detail ??
            "Claude Code was not detected on this workstation. " +
              "The finding can still be edited manually.",
          null,
          null,
        ),
      );
    }

    const window = dependencies.window();
    let runId: string | null = null;

    try {
      const prepared = await apiClient.request<PreparedAiRun>("/v1/ai/runs", {
        method: "POST",
        body: {
          action: request.action,
          targetType: request.targetType,
          targetId: request.targetId,
          ...(typeof request.instruction === "string"
            ? { instruction: request.instruction }
            : {}),
          providerId,
          // Preferences only. The server checks both against the workspace
          // allow-list and refuses rather than downgrading, so a run never
          // claims a model it did not use.
          ...(typeof request.model === "string"
            ? { model: request.model }
            : {}),
          ...(typeof request.effort === "string"
            ? { effort: request.effort }
            : {}),
        },
      });

      runId = prepared.id;

      window?.webContents.send(IPC_CHANNELS.aiRunState, {
        runId: prepared.id,
        status: "RUNNING",
      });

      const controller = new AbortController();

      dependencies.registerCancellation(prepared.id, controller);

      const result = await provider.run({
        action: prepared.action,
        prompt: prepared.promptText,
        // Both decided by the server, alongside the context filtering.
        profile: prepared.profile,
        outputSchema: prepared.outputSchema,
        environmentAllowlist: [...DEFAULT_ENVIRONMENT_ALLOWLIST],
        signal: controller.signal,
      });

      const status = result.cancelled
        ? "CANCELLED"
        : result.timedOut ||
            result.exitCode !== 0 ||
            result.providerError !== null
          ? "FAILED"
          : "COMPLETED";

      const submitted = await apiClient.request<AiRunWithProposals>(
        `/v1/ai/runs/${prepared.id}/result`,
        {
          method: "POST",
          body: {
            status,
            providerVersion: result.version ?? undefined,
            durationMs: result.durationMs,
            ...(result.costUsd === null ? {} : { costUsd: result.costUsd }),
            ...(result.inputTokens === null
              ? {}
              : { inputTokens: result.inputTokens }),
            ...(result.outputTokens === null
              ? {}
              : { outputTokens: result.outputTokens }),
            toolDenials: result.toolDenials,
            ...(status === "COMPLETED" ? { output: result.stdout } : {}),
            ...(status === "COMPLETED"
              ? {}
              : {
                  failureReason: result.timedOut
                    ? "The provider exceeded its time limit."
                    : result.cancelled
                      ? "Cancelled by the researcher."
                      : (result.providerError ??
                        (result.stderr.slice(0, 500) ||
                          `The provider exited with status ${result.exitCode}.`)),
                }),
          },
        },
      );

      window?.webContents.send(IPC_CHANNELS.aiRunState, {
        runId: prepared.id,
        status: submitted.status,
      });

      return { ok: true as const, data: submitted };
    } catch (error: unknown) {
      if (runId !== null) {
        window?.webContents.send(IPC_CHANNELS.aiRunState, {
          runId,
          status: "FAILED",
        });
      }

      return failure(error);
    }
  });

  handle(IPC_CHANNELS.aiCancel, async (payload) => {
    if (typeof payload === "string") {
      dependencies.cancelRun(payload);
    }
  });
}

function safeReportExportFilename(
  filename: string,
  format: "PDF" | "MARKDOWN",
): string {
  const leaf = filename.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const safe = leaf.replace(/\p{Cc}/gu, "_").trim();
  const extension = format === "PDF" ? ".pdf" : ".md";

  return safe.toLowerCase().endsWith(extension) &&
    safe.length > extension.length
    ? safe
    : `report${extension}`;
}

function desktopArchiveManifest(value: unknown): CvcaseManifest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("format" in value) ||
    value.format !== "codevault.cvcase" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("artifacts" in value) ||
    !Array.isArray(value.artifacts)
  ) {
    throw new Error("The server returned an invalid case archive manifest.");
  }
  return value as CvcaseManifest;
}

async function uploadArchiveArtifact(
  path: string,
  sizeBytes: number,
  instructions: PrepareCaseArchiveImportResult["uploads"][number],
): Promise<Array<{ partNumber: number; etag: string }>> {
  if (instructions.strategy === "SINGLE") {
    if (instructions.url === null) {
      throw new Error("The server did not return an archive upload URL.");
    }
    const requestInit: RequestInit & { duplex: "half" } = {
      method: "PUT",
      headers: instructions.requiredHeaders,
      body: createReadStream(path) as never,
      duplex: "half",
    };
    const response = await fetch(instructions.url, requestInit);
    if (!response.ok) {
      throw new Error(
        `Object storage rejected the archive upload (${response.status}).`,
      );
    }
    return [];
  }

  const handle = await open(path, "r");
  const parts: Array<{ partNumber: number; etag: string }> = [];
  try {
    for (const [index, url] of instructions.partUrls.entries()) {
      const length = Math.min(
        instructions.partSizeBytes,
        sizeBytes - index * instructions.partSizeBytes,
      );
      if (length <= 0) break;
      const bytes = Buffer.alloc(length);
      await handle.read(bytes, 0, length, index * instructions.partSizeBytes);
      const response = await fetch(url, {
        method: "PUT",
        headers: { "content-length": String(length) },
        body: bytes,
      });
      if (!response.ok) {
        throw new Error(
          `Object storage rejected archive part ${index + 1} (${response.status}).`,
        );
      }
      const etag = response.headers.get("etag");
      if (etag === null) {
        throw new Error(
          `Object storage returned no ETag for archive part ${index + 1}.`,
        );
      }
      parts.push({ partNumber: index + 1, etag });
    }
    return parts;
  } finally {
    await handle.close();
  }
}
