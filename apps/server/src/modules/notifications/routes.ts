import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";

import {
  ErrorResponse,
  IdParam,
  NotificationReadResult,
  SecurityNotification,
  SecurityNotificationInbox,
} from "@codevault/contracts";
import { notFound } from "@codevault/core";
import { schema } from "@codevault/db";

import type { AppInstance } from "../../http/app-instance.js";
import { actingUser } from "../../http/guards.js";
import { readableCaseIdsSubquery } from "../findings/queries.js";

export async function registerNotificationRoutes(
  app: AppInstance,
): Promise<void> {
  app.get(
    "/v1/notifications",
    { schema: { response: { 200: SecurityNotificationInbox } } },
    async (request) => {
      const user = actingUser(request);
      const scope = and(
        eq(schema.securityNotifications.userId, user.id),
        eq(schema.securityNotifications.organizationId, user.organizationId),
        or(
          isNull(schema.securityNotifications.caseId),
          sql`${schema.securityNotifications.caseId} IN ${readableCaseIdsSubquery(user)}`,
        ),
      );
      const [items, unread] = await Promise.all([
        app.db
          .select({
            id: schema.securityNotifications.id,
            eventType: schema.securityNotifications.eventType,
            details: schema.securityNotifications.details,
            occurredAt: schema.securityNotifications.occurredAt,
            readAt: schema.securityNotifications.readAt,
          })
          .from(schema.securityNotifications)
          .where(scope)
          .orderBy(desc(schema.securityNotifications.occurredAt))
          .limit(100),
        app.db
          .select({ value: count() })
          .from(schema.securityNotifications)
          .where(and(scope, isNull(schema.securityNotifications.readAt))),
      ]);

      return { items, unreadCount: unread[0]?.value ?? 0 };
    },
  );

  app.post(
    "/v1/notifications/read-all",
    { schema: { response: { 200: NotificationReadResult } } },
    async (request) => {
      const user = actingUser(request);
      const updated = await app.db
        .update(schema.securityNotifications)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(schema.securityNotifications.userId, user.id),
            eq(
              schema.securityNotifications.organizationId,
              user.organizationId,
            ),
            or(
              isNull(schema.securityNotifications.caseId),
              sql`${schema.securityNotifications.caseId} IN ${readableCaseIdsSubquery(user)}`,
            ),
            isNull(schema.securityNotifications.readAt),
          ),
        )
        .returning({ id: schema.securityNotifications.id });

      return { updatedCount: updated.length };
    },
  );

  app.post(
    "/v1/notifications/:id/read",
    {
      schema: {
        params: IdParam,
        response: { 200: SecurityNotification, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const updated = await app.db
        .update(schema.securityNotifications)
        .set({
          readAt: sql`coalesce(${schema.securityNotifications.readAt}, now())`,
        })
        .where(
          and(
            eq(schema.securityNotifications.id, request.params.id),
            eq(schema.securityNotifications.userId, user.id),
            eq(
              schema.securityNotifications.organizationId,
              user.organizationId,
            ),
            or(
              isNull(schema.securityNotifications.caseId),
              sql`${schema.securityNotifications.caseId} IN ${readableCaseIdsSubquery(user)}`,
            ),
          ),
        )
        .returning({
          id: schema.securityNotifications.id,
          eventType: schema.securityNotifications.eventType,
          details: schema.securityNotifications.details,
          occurredAt: schema.securityNotifications.occurredAt,
          readAt: schema.securityNotifications.readAt,
        });

      if (updated[0] === undefined) throw notFound("Notification not found.");
      return updated[0];
    },
  );
}
