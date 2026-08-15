import type { ServerEvent } from "@codevault/contracts";

import type { SessionStore } from "./session-store.js";

/**
 * Server-sent event bridge.
 *
 * The main process holds the one authenticated stream and forwards events to
 * the renderer, which uses them to invalidate cached queries. Keeping the
 * connection here means the renderer never needs network access at all, which
 * is what lets its CSP say `connect-src 'none'`.
 */

export interface EventBridgeOptions {
  sessionStore: SessionStore;
  onEvent: (event: ServerEvent) => void;
  onConnectionChange: (connected: boolean) => void;
  fetchImpl?: typeof fetch;
}

export interface EventBridge {
  start(): void;
  stop(): void;
  connected(): boolean;
}

/** Backoff bounds for reconnection, in milliseconds. */
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export function createEventBridge(options: EventBridgeOptions): EventBridge {
  const doFetch = options.fetchImpl ?? fetch;
  let controller: AbortController | null = null;
  let retryMs = MIN_RETRY_MS;
  let stopped = true;
  let connected = false;
  let retryTimer: NodeJS.Timeout | null = null;

  const setConnected = (next: boolean): void => {
    if (connected !== next) {
      connected = next;
      options.onConnectionChange(next);
    }
  };

  const scheduleRetry = (): void => {
    if (stopped) {
      return;
    }

    retryTimer = setTimeout(() => {
      void connect();
    }, retryMs);

    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  };

  const connect = async (): Promise<void> => {
    const session = options.sessionStore.current();

    if (session === null) {
      setConnected(false);
      scheduleRetry();

      return;
    }

    controller = new AbortController();

    try {
      const response = await doFetch(
        new URL("/v1/events", session.serverUrl).toString(),
        {
          headers: {
            authorization: `Bearer ${session.token}`,
            accept: "text/event-stream",
          },
          signal: controller.signal,
        },
      );

      if (!response.ok || response.body === null) {
        throw new Error(`stream refused (${response.status})`);
      }

      setConnected(true);
      retryMs = MIN_RETRY_MS;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; anything after the last
        // separator is an incomplete frame and stays in the buffer.
        const frames = buffer.split("\n\n");

        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const dataLine = frame
            .split("\n")
            .find((line) => line.startsWith("data:"));

          if (dataLine === undefined) {
            continue;
          }

          try {
            options.onEvent(
              JSON.parse(dataLine.slice(5).trim()) as ServerEvent,
            );
          } catch {
            // A malformed frame is dropped. The client refetches on the next
            // event or navigation, so nothing is lost but a moment of freshness.
          }
        }
      }

      setConnected(false);
      scheduleRetry();
    } catch {
      setConnected(false);
      scheduleRetry();
    }
  };

  return {
    start() {
      if (!stopped) {
        return;
      }

      stopped = false;
      retryMs = MIN_RETRY_MS;
      void connect();
    },

    stop() {
      stopped = true;

      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }

      controller?.abort();
      controller = null;
      setConnected(false);
    },

    connected() {
      return connected;
    },
  };
}
