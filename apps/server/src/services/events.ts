import { uuidv7 } from "@codevault/core/crypto";
import type { ServerEvent, ServerEventType } from "@codevault/contracts";

/**
 * Server-sent event broker.
 *
 * Events carry identifiers, never entity contents: a subscriber's job is to
 * invalidate the right query and refetch through the ordinary authorised route.
 * A pushed payload would otherwise be a second, unaudited read path around case
 * access control.
 */

export interface EventSubscriber {
  id: string;
  /** Case IDs the subscriber may see; null means "every case they can read". */
  userId: string;
  /** Present for real client streams; tests may omit it for broker-only checks. */
  sessionId?: string;
  send(event: ServerEvent): void;
}

export interface PublishInput {
  type: ServerEventType;
  entityType: string;
  entityId: string;
  caseId: string | null;
  /** Required for access-change events, including post-revocation eviction. */
  targetUserId?: string;
  detail?: Record<string, unknown>;
}

export interface EventBroker {
  subscribe(subscriber: EventSubscriber): () => void;
  publish(input: PublishInput): ServerEvent;
  subscriberCount(): number;
  /** Decides whether a subscriber may be told about a case at all. */
  setVisibilityFilter(filter: CaseVisibilityFilter): void;
}

/** Answers "may this user be told that something changed in this case?". */
export type CaseVisibilityFilter = (
  userId: string,
  caseId: string | null,
  sessionId?: string,
) => boolean | Promise<boolean>;

export function createEventBroker(): EventBroker {
  const subscribers = new Map<string, EventSubscriber>();
  let visibilityFilter: CaseVisibilityFilter = () => true;

  return {
    subscribe(subscriber) {
      subscribers.set(subscriber.id, subscriber);

      return () => {
        subscribers.delete(subscriber.id);
      };
    },

    publish(input) {
      if (
        (input.type === "case.access_changed") !==
        (input.targetUserId !== undefined)
      ) {
        throw new Error(
          "Case access events must be targeted, and only case access events may be targeted.",
        );
      }

      const event: ServerEvent = {
        id: uuidv7(),
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        caseId: input.caseId,
        detail: input.detail ?? {},
        occurredAt: new Date().toISOString(),
      };

      for (const subscriber of subscribers.values()) {
        if (input.targetUserId !== undefined) {
          if (subscriber.userId !== input.targetUserId) {
            continue;
          }

          if (input.detail?.["canRead"] === false) {
            subscriber.send(event);
          } else {
            void Promise.resolve(
              visibilityFilter(
                subscriber.userId,
                event.caseId,
                subscriber.sessionId,
              ),
            )
              .then((allowed) => {
                if (allowed) {
                  subscriber.send(event);
                }
              })
              .catch(() => {
                // Grant/update events fail closed. Only revocation events may
                // bypass visibility so clients can evict stale case data.
              });
          }
          continue;
        }

        void Promise.resolve(
          visibilityFilter(
            subscriber.userId,
            event.caseId,
            subscriber.sessionId,
          ),
        )
          .then((allowed) => {
            if (allowed) {
              subscriber.send(event);
            }
          })
          .catch(() => {
            // A filter failure must never leak the event; dropping it only
            // costs the subscriber a refetch on its next poll or navigation.
          });
      }

      return event;
    },

    subscriberCount() {
      return subscribers.size;
    },

    setVisibilityFilter(filter) {
      visibilityFilter = filter;
    },
  };
}

/** Formats one event as an SSE frame. */
export function formatSseFrame(event: ServerEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
