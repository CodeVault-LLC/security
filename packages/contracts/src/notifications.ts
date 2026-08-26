import { Type, type Static } from "@sinclair/typebox";

import { Timestamp, Uuid } from "./common.js";

const NotificationDetailValue = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);

export const SecurityNotification = Type.Object({
  id: Uuid,
  eventType: Type.String({ maxLength: 120 }),
  details: Type.Record(Type.String(), NotificationDetailValue),
  occurredAt: Timestamp,
  readAt: Type.Union([Timestamp, Type.Null()]),
});

export type SecurityNotification = Static<typeof SecurityNotification>;

export const SecurityNotificationInbox = Type.Object({
  items: Type.Array(SecurityNotification, { maxItems: 100 }),
  unreadCount: Type.Integer({ minimum: 0 }),
});

export type SecurityNotificationInbox = Static<
  typeof SecurityNotificationInbox
>;

export const NotificationReadResult = Type.Object({
  updatedCount: Type.Integer({ minimum: 0 }),
});

export type NotificationReadResult = Static<typeof NotificationReadResult>;
