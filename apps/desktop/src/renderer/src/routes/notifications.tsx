import { Check, ShieldAlert } from "lucide-react";

import type {
  SecurityNotification,
  SecurityNotificationInbox,
} from "@codevault/contracts";
import { Button, Card, CardBody, EmptyState } from "@codevault/ui";

import { PageBody, PageHeader } from "../components/app-shell.js";
import { QueryBoundary } from "../components/query-boundary.js";
import { queryKeys, useApiMutation, useApiQuery } from "../lib/api.js";
import { formatDateTime } from "../lib/dates.js";
import { humanise } from "../lib/format.js";

const EVENT_LABELS: Record<string, string> = {
  RECOVERY_CODE_USED: "Recovery code used",
  TOTP_REPLACED: "Authenticator replaced",
};

export function NotificationsRoute(): React.JSX.Element {
  const inbox = useApiQuery<SecurityNotificationInbox>(
    queryKeys.notifications,
    "/v1/notifications",
  );
  const read = useApiMutation<SecurityNotification, string>(
    (id) => ({ path: `/v1/notifications/${id}/read`, method: "POST" }),
    () => [queryKeys.notifications],
  );
  const readAll = useApiMutation<{ updatedCount: number }>(
    () => ({ path: "/v1/notifications/read-all", method: "POST" }),
    () => [queryKeys.notifications],
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Notifications"
        description="Durable account-security events for your user."
        actions={
          <Button
            size="sm"
            variant="secondary"
            disabled={(inbox.data?.unreadCount ?? 0) === 0}
            loading={readAll.isPending}
            onClick={() => readAll.mutate()}
          >
            <Check aria-hidden className="size-3.5" />
            Mark all read
          </Button>
        }
      />
      <PageBody>
        <QueryBoundary query={inbox} loadingLabel="Loading notifications…">
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState
                title="No security notifications"
                description="Recovery and authenticator changes will appear here."
              />
            ) : (
              <Card>
                <ul className="divide-y divide-border">
                  {data.items.map((notification) => (
                    <li
                      key={notification.id}
                      className={
                        notification.readAt === null ? "bg-accent/4" : undefined
                      }
                    >
                      <CardBody className="flex items-start gap-3 py-3">
                        <span className="relative mt-0.5 rounded-full bg-surface-raised p-2 text-text-muted">
                          <ShieldAlert aria-hidden className="size-4" />
                          {notification.readAt === null ? (
                            <span
                              aria-label="Unread"
                              className="absolute right-0 top-0 size-2 rounded-full bg-accent"
                            />
                          ) : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium">
                            {EVENT_LABELS[notification.eventType] ??
                              humanise(notification.eventType)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-text-muted">
                            {formatDateTime(notification.occurredAt)}
                          </p>
                          {Object.keys(notification.details).length ===
                          0 ? null : (
                            <dl className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
                              {Object.entries(notification.details).map(
                                ([key, value]) => (
                                  <div key={key} className="flex gap-1.5">
                                    <dt className="text-text-muted">
                                      {humanise(key)}:
                                    </dt>
                                    <dd>{String(value)}</dd>
                                  </div>
                                ),
                              )}
                            </dl>
                          )}
                        </div>
                        {notification.readAt === null ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={read.isPending}
                            onClick={() => read.mutate(notification.id)}
                          >
                            Mark read
                          </Button>
                        ) : null}
                      </CardBody>
                    </li>
                  ))}
                </ul>
              </Card>
            )
          }
        </QueryBoundary>
      </PageBody>
    </div>
  );
}
