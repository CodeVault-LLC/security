import type { QueryClient } from "@tanstack/react-query";

import type { MailThreadDetail, ServerEvent } from "@codevault/contracts";

import { bridge } from "./bridge.js";
import { queryKeys } from "./api.js";

/**
 * Event-driven cache invalidation.
 *
 * A server event names what changed; this maps that onto the query keys that
 * are now stale and lets TanStack Query refetch them through the ordinary
 * authorised route. The event payload itself is never written into the cache —
 * doing so would be a second, unaudited path for data to reach the screen.
 */

export function invalidateForEvent(
  queryClient: QueryClient,
  event: ServerEvent,
): void {
  if (
    event.type === "case.access_changed" &&
    event.detail["canRead"] === false
  ) {
    // Revocation is rare and security-sensitive. Clear all cached server data
    // because derived finding/report/search records do not all carry case IDs
    // in their query keys.
    queryClient.clear();
    return;
  }

  const invalidate = (key: readonly unknown[]): void => {
    void queryClient.invalidateQueries({ queryKey: key });
  };

  if (event.caseId !== null) {
    invalidate(queryKeys.case(event.caseId));
    invalidate(queryKeys.reports(event.caseId));
    invalidate(queryKeys.disclosure(event.caseId));
    invalidate(queryKeys.caseReadiness(event.caseId));
  }

  switch (event.entityType) {
    case "finding": {
      invalidate(queryKeys.finding(event.entityId));
      invalidate(["findings"]);
      break;
    }

    case "case": {
      invalidate(["cases"]);
      break;
    }

    case "asset": {
      invalidate(queryKeys.asset(event.entityId));
      invalidate(["assets"]);
      break;
    }

    case "evidence":
    case "artifact": {
      invalidate(["evidence"]);
      break;
    }

    case "report":
    case "report_section":
    case "report_export": {
      invalidate(["report"]);
      invalidate(["reports"]);
      break;
    }

    case "prior_art_check": {
      invalidate(["prior-art"]);
      invalidate(["findings"]);
      break;
    }

    case "scanner_sync_profile": {
      if (event.caseId !== null) {
        invalidate(queryKeys.scannerSyncProfiles(event.caseId));
      }
      break;
    }

    case "intelligence_refresh_policy": {
      invalidate(queryKeys.intelligenceRefresh(event.entityId));
      break;
    }

    case "disclosure": {
      invalidate(["disclosure"]);
      break;
    }

    case "organization_security_policy": {
      if (event.detail["mailHtmlRenderingEnabled"] === false) {
        queryClient.setQueriesData<MailThreadDetail>(
          { queryKey: ["mailbox-thread"] },
          (thread) =>
            thread === undefined
              ? undefined
              : {
                  ...thread,
                  htmlRenderingAllowed: false,
                  messages: thread.messages.map((message) => ({
                    ...message,
                    bodyHtml: null,
                  })),
                },
        );
      }
      invalidate(queryKeys.mailPreferences);
      invalidate(["mailbox-thread"]);
      break;
    }

    default: {
      // An unknown entity type still means something moved, so the operational
      // views refresh rather than silently drifting.
      break;
    }
  }

  invalidate(queryKeys.dashboard);
  invalidate(["activity"]);
  // Every aggregate on the dashboard, the metrics page and both asset views
  // sits under this prefix, so one entry keeps the charts as live as the lists
  // they sit above.
  invalidate(["metrics"]);
}

export interface EventSubscription {
  stop(): void;
}

export function subscribeToServerEvents(
  queryClient: QueryClient,
  onConnectionChange: (connected: boolean) => void,
): EventSubscription {
  const api = bridge();
  const unsubscribeEvents = api.events.subscribe((event) => {
    invalidateForEvent(queryClient, event);
  });
  const unsubscribeConnection =
    api.events.onConnectionChange(onConnectionChange);

  return {
    stop() {
      unsubscribeEvents();
      unsubscribeConnection();
    },
  };
}
