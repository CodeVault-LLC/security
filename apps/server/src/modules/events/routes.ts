import type { AppInstance } from "../../http/app-instance.js";

import { uuidv7 } from "@codevault/core/crypto";

import { principalOf } from "../../http/guards.js";
import { isSessionActive } from "../../auth/session.js";
import { formatSseFrame } from "../../services/events.js";

/**
 * Server-sent events.
 *
 * Clients subscribe once and use the events to invalidate cached queries. The
 * payload carries identifiers only — the client refetches through the ordinary
 * authorised route, so the stream never becomes a second, unaudited read path.
 *
 * Implemented directly on the raw response rather than through a plugin: SSE is
 * a content type and a keep-alive, and a dependency for that would be more
 * surface than substance.
 */

/** Comment frames keep proxies from closing an idle connection. */
const HEARTBEAT_INTERVAL_MS = 25_000;

export async function registerEventRoutes(app: AppInstance): Promise<void> {
  app.get("/v1/events", async (request, reply) => {
    const principal = principalOf(request);
    const subscriberId = uuidv7();

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // The desktop client is the only consumer and it does not proxy; this
      // stops an intermediary from buffering the stream into uselessness.
      "x-accel-buffering": "no",
    });

    reply.raw.write(`: connected ${subscriberId}\n\n`);

    const unsubscribe = app.events.subscribe({
      id: subscriberId,
      userId: principal.user.id,
      sessionId: principal.session.id,
      send(event) {
        if (!reply.raw.writableEnded) {
          reply.raw.write(formatSseFrame(event));
        }
      },
    });

    const heartbeat = setInterval(() => {
      if (reply.raw.writableEnded) {
        return;
      }
      void isSessionActive(app.db, principal.session.id, principal.user.id)
        .then((active) => {
          if (!active) {
            reply.raw.end();
            return;
          }
          if (!reply.raw.writableEnded) {
            reply.raw.write(`: heartbeat\n\n`);
          }
        })
        .catch(() => reply.raw.end());
    }, HEARTBEAT_INTERVAL_MS);

    const close = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    request.raw.on("close", close);
    request.raw.on("error", close);

    // Fastify must not try to serialise a reply for a stream it does not own.
    return reply;
  });
}
