import { Type, type Static } from "@sinclair/typebox";

import { RevisionField, Timestamp, Uuid } from "./common.js";

export const RemediationSla = Type.Object({
  findingId: Uuid,
  startedAt: Timestamp,
  targetAt: Timestamp,
  note: Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
  status: Type.Union([
    Type.Literal("ON_TRACK"),
    Type.Literal("AT_RISK"),
    Type.Literal("OVERDUE"),
    Type.Literal("MET"),
  ]),
  remainingDays: Type.Integer(),
  revision: RevisionField,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type RemediationSla = Static<typeof RemediationSla>;

export const RemediationSlaSettings = Type.Object({
  sla: Type.Union([RemediationSla, Type.Null()]),
});
export type RemediationSlaSettings = Static<typeof RemediationSlaSettings>;

export const SetRemediationSlaRequest = Type.Object(
  {
    targetAt: Timestamp,
    note: Type.Optional(
      Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
    ),
    expectedRevision: Type.Optional(RevisionField),
  },
  { additionalProperties: false },
);
export type SetRemediationSlaRequest = Static<typeof SetRemediationSlaRequest>;
