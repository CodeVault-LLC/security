import { app, dialog, ipcMain, shell, type BrowserWindow } from "electron";

import type {
  AiContextPreview,
  AiRunWithProposals,
  InviteInspection,
  LoginStartResponse,
  LoginResponse,
  PreparedAiRun,
  RecoveryCodeBundle,
  TotpEnrollmentResponse,
} from "@codevault/contracts";

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
import { hashSelection, runUploads } from "./file-uploads.js";
import { loadAvatarDataUrl, selectAndUploadAvatar } from "./avatar-uploads.js";
import { isExternalUrlAllowed } from "./security.js";
import type { SessionStore } from "./session-store.js";

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
  const { sessionStore, apiClient, providers } = dependencies;
  let pendingLogin: {
    serverUrl: string;
    challengeToken: string;
  } | null = null;
  let pendingInvitation: { serverUrl: string; token: string } | null = null;
  let pendingEnrollment: {
    serverUrl: string;
    enrollmentToken: string;
  } | null = null;

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

  handle(IPC_CHANNELS.authLoginStart, async (payload) => {
    const request = payload as {
      serverUrl?: unknown;
      email?: unknown;
      password?: unknown;
    };

    if (
      typeof request.serverUrl !== "string" ||
      typeof request.email !== "string" ||
      typeof request.password !== "string"
    ) {
      return failure(new Error("invalid login payload"));
    }

    try {
      const response = await apiClient.request<LoginStartResponse>(
        "/v1/auth/login/start",
        {
          method: "POST",
          body: { email: request.email, password: request.password },
          serverUrl: request.serverUrl,
          anonymous: true,
        },
      );
      pendingLogin = {
        serverUrl: request.serverUrl,
        challengeToken: response.challengeToken,
      };
      return {
        ok: true as const,
        data: { challenge: response.challenge, expiresAt: response.expiresAt },
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
          },
          serverUrl: pendingLogin.serverUrl,
          anonymous: true,
        },
      );
      const serverUrl = pendingLogin.serverUrl;
      pendingLogin = null;
      const status = await sessionStore.save({
        token: response.token,
        serverUrl,
        expiresAt: response.expiresAt,
        userId: response.user.id,
      });
      const result: AuthResult = {
        user: response.user,
        persistent: status.persistent,
        storageWarning: status.persistent
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

  handle(IPC_CHANNELS.invitationInspect, async (payload) => {
    const request = payload as { serverUrl?: unknown; token?: unknown };
    if (
      typeof request.serverUrl !== "string" ||
      typeof request.token !== "string"
    )
      return failure(new Error("invalid invitation payload"));
    try {
      const inspection = await apiClient.request<InviteInspection>(
        "/v1/invitations/inspect",
        {
          method: "POST",
          body: { token: request.token },
          serverUrl: request.serverUrl,
          anonymous: true,
        },
      );
      pendingInvitation = {
        serverUrl: request.serverUrl,
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
    pendingInvitation = null;
    pendingEnrollment = null;
    try {
      await apiClient.request("/v1/auth/logout", { method: "POST" });
    } catch {
      // The local session is cleared regardless: a server that cannot be
      // reached must not leave a token sitting on the workstation.
    }

    await sessionStore.clear();
  });

  handle(IPC_CHANNELS.authRestore, async () => {
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

    if (window === null) {
      return [];
    }

    const selection = await dialog.showOpenDialog(window, {
      title: "Add evidence",
      properties: ["openFile", "multiSelections", "dontAddToRecent"],
    });

    if (selection.canceled) {
      return [];
    }

    const results = [];

    for (const path of selection.filePaths) {
      results.push(await hashSelection(path));
    }

    return results;
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

  handle(IPC_CHANNELS.uploadsStart, async (payload) => {
    const window = dependencies.window();

    try {
      const artifactIds = await runUploads({
        request: payload as StartUploadRequest,
        apiClient,
        onProgress: (progress) => {
          window?.webContents.send(IPC_CHANNELS.uploadsProgress, progress);
        },
      });

      return { ok: true as const, data: artifactIds };
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
