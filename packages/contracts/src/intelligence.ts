import { Type, type Static } from "@sinclair/typebox";

import { RevisionField, Timestamp, Uuid, enumOf } from "./common.js";

export const INTELLIGENCE_REFRESH_CADENCES = ["DAILY", "WEEKLY"] as const;
export const IntelligenceRefreshCadenceSchema = enumOf(
  INTELLIGENCE_REFRESH_CADENCES,
);

export const IntelligenceRefreshPolicy = Type.Object({
  findingId: Uuid,
  cadence: IntelligenceRefreshCadenceSchema,
  enabled: Type.Boolean(),
  lastQueuedAt: Type.Union([Timestamp, Type.Null()]),
  nextRunAt: Type.Union([Timestamp, Type.Null()]),
  revision: RevisionField,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type IntelligenceRefreshPolicy = Static<
  typeof IntelligenceRefreshPolicy
>;

export const IntelligenceRefreshSettings = Type.Object({
  policy: Type.Union([IntelligenceRefreshPolicy, Type.Null()]),
});
export type IntelligenceRefreshSettings = Static<
  typeof IntelligenceRefreshSettings
>;

export const SetIntelligenceRefreshPolicyRequest = Type.Object(
  {
    cadence: IntelligenceRefreshCadenceSchema,
    enabled: Type.Boolean(),
    expectedRevision: Type.Optional(RevisionField),
  },
  { additionalProperties: false },
);
export type SetIntelligenceRefreshPolicyRequest = Static<
  typeof SetIntelligenceRefreshPolicyRequest
>;

export const IntelligenceRefreshQueued = Type.Object({
  findingId: Uuid,
  queuedAt: Timestamp,
  cveIds: Type.Array(Type.String({ pattern: "^CVE-[0-9]{4}-[0-9]{4,}$" })),
});
export type IntelligenceRefreshQueued = Static<
  typeof IntelligenceRefreshQueued
>;
