import type { ErrorResponse } from "@codevault/contracts";

import type { SessionStore } from "./session-store.js";
import { normalizeServerUrl } from "./security.js";

/**
 * API client.
 *
 * Lives in the main process because it is the only thing that holds the bearer
 * token. The renderer asks for an operation; this attaches credentials and
 * talks to the server. That separation is what keeps a payload rendered inside
 * a finding from being able to read the session token.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly category: string;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | null;

  constructor(
    status: number,
    category: string,
    message: string,
    requestId: string | null,
    details: Record<string, unknown> | null,
  ) {
    super(message);

    this.name = "ApiError";
    this.status = status;
    this.category = category;
    this.requestId = requestId;
    this.details = details;
  }
}

export interface ApiClientOptions {
  sessionStore: SessionStore;
  /** Notifies the renderer that every authenticated screen must close. */
  onSessionExpired?: () => void;
  /** Overridden in tests. */
  fetchImpl?: typeof fetch;
  /** Milliseconds before a request is abandoned. */
  timeoutMs?: number;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Overrides the stored server URL, used during login. */
  serverUrl?: string;
  /** Sends the request without credentials, for login itself. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  serverUrl(): string | null;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    serverUrl() {
      return options.sessionStore.current()?.serverUrl ?? null;
    },

    async request<T>(path: string, request: RequestOptions = {}): Promise<T> {
      const session = options.sessionStore.current();
      const untrustedBaseUrl = request.serverUrl ?? session?.serverUrl;

      if (untrustedBaseUrl === undefined) {
        throw new ApiError(
          0,
          "PROVIDER_UNAVAILABLE",
          "No CodeVault Security server is configured.",
          null,
          null,
        );
      }
      const baseUrl = normalizeServerUrl(untrustedBaseUrl);
      if (baseUrl === null) {
        throw new ApiError(
          0,
          "VALIDATION",
          "The CodeVault Security server URL is not allowed.",
          null,
          null,
        );
      }

      const target = new URL(path, baseUrl);

      if (!path.startsWith("/") || target.origin !== baseUrl) {
        throw new ApiError(
          0,
          "VALIDATION",
          "The API path must stay on the configured CodeVault Security server.",
          null,
          null,
        );
      }

      const headers: Record<string, string> = {
        accept: "application/json",
      };

      if (request.body !== undefined) {
        headers["content-type"] = "application/json";
      }

      if (request.anonymous !== true && session !== null) {
        headers.authorization = `Bearer ${session.token}`;
      }

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const abortFromCaller = (): void => controller.abort();

      if (request.signal !== undefined) {
        if (request.signal.aborted) {
          controller.abort();
        } else {
          request.signal.addEventListener("abort", abortFromCaller, {
            once: true,
          });
        }
      }

      try {
        if (controller.signal.aborted) {
          throw new DOMException("The request was cancelled.", "AbortError");
        }

        const response = await doFetch(target.toString(), {
          method: request.method ?? "GET",
          headers,
          body:
            request.body === undefined ? null : JSON.stringify(request.body),
          signal: controller.signal,
        });

        if (response.status === 204) {
          return undefined as T;
        }

        const text = await response.text();
        let payload: unknown = null;

        if (text.length > 0) {
          try {
            payload = JSON.parse(text) as unknown;
          } catch {
            throw new ApiError(
              response.status,
              "SERVER_ERROR",
              "The server returned invalid JSON.",
              null,
              null,
            );
          }
        }

        if (!response.ok) {
          const error = toApiError(response.status, payload);

          if (response.status === 401 && request.anonymous !== true) {
            await options.sessionStore.clear();
            options.onSessionExpired?.();
          }

          throw error;
        }

        return payload as T;
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          throw error;
        }

        if (controller.signal.aborted) {
          throw new ApiError(
            0,
            "PROVIDER_UNAVAILABLE",
            timedOut
              ? "The request to the CodeVault Security server timed out."
              : "The request was cancelled.",
            null,
            null,
          );
        }

        throw new ApiError(
          0,
          "PROVIDER_UNAVAILABLE",
          "The CodeVault Security server could not be reached.",
          null,
          null,
        );
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abortFromCaller);
      }
    },
  };
}

function toApiError(status: number, payload: unknown): ApiError {
  const envelope = payload as Partial<ErrorResponse> | null;
  const error = envelope?.error;

  if (error === undefined) {
    return new ApiError(
      status,
      status >= 500 ? "SERVER_ERROR" : "VALIDATION",
      "The server returned an unexpected response.",
      null,
      null,
    );
  }

  return new ApiError(
    status,
    error.category,
    error.message,
    error.requestId ?? null,
    error.details ?? null,
  );
}
