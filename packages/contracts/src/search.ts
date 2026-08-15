import { Type, type Static } from "@sinclair/typebox";

import {
  HumanReference,
  SeveritySchema,
  Timestamp,
  Uuid,
} from "./common.js";

/**
 * Search and event-stream contracts.
 *
 * Search returns grouped results so the command palette can render them without
 * post-processing, and events carry just enough to invalidate a query key.
 */

export const SearchGroupSchema = Type.Union([
  Type.Literal("CASES"),
  Type.Literal("FINDINGS"),
  Type.Literal("ASSETS"),
  Type.Literal("EVIDENCE"),
  Type.Literal("REPORTS"),
]);

export type SearchGroup = Static<typeof SearchGroupSchema>;

export const SearchHit = Type.Object({
  group: SearchGroupSchema,
  id: Uuid,
  ref: HumanReference,
  title: Type.String(),
  /** Highlighted snippet, already escaped for plain-text rendering. */
  snippet: Type.Union([Type.String(), Type.Null()]),
  /** Higher is better; exact identifier matches dominate the ranking. */
  score: Type.Number(),
  /** Why this hit matched, so a hash or CVE hit reads differently to a text hit. */
  matchKind: Type.Union([
    Type.Literal("EXACT_REFERENCE"),
    Type.Literal("EXACT_IDENTIFIER"),
    Type.Literal("HASH"),
    Type.Literal("FULL_TEXT"),
    Type.Literal("FUZZY_NAME"),
  ]),
  caseId: Type.Union([Uuid, Type.Null()]),
  severity: Type.Union([SeveritySchema, Type.Null()]),
  updatedAt: Timestamp,
});

export type SearchHit = Static<typeof SearchHit>;

export const SearchQuery = Type.Object({
  q: Type.String({ minLength: 1, maxLength: 300 }),
  groups: Type.Optional(Type.Array(SearchGroupSchema)),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 30 })),
});

export type SearchQuery = Static<typeof SearchQuery>;

export const SearchResponse = Type.Object({
  query: Type.String(),
  groups: Type.Array(
    Type.Object({
      group: SearchGroupSchema,
      hits: Type.Array(SearchHit),
      total: Type.Integer({ minimum: 0 }),
    }),
  ),
  tookMs: Type.Integer({ minimum: 0 }),
});

export type SearchResponse = Static<typeof SearchResponse>;

export const SERVER_EVENT_TYPES = [
  "entity.changed",
  "job.progress",
  "prior_art.completed",
  "report.exported",
  "intelligence.updated",
] as const;

export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];

export const ServerEvent = Type.Object({
  id: Type.String(),
  type: Type.Union(SERVER_EVENT_TYPES.map((type) => Type.Literal(type))),
  /** Entity kind such as `finding` or `report`, used to build query keys. */
  entityType: Type.String({ maxLength: 60 }),
  entityId: Type.String({ maxLength: 100 }),
  caseId: Type.Union([Uuid, Type.Null()]),
  /** Small payload; clients refetch rather than trusting pushed state. */
  detail: Type.Record(Type.String(), Type.Unknown()),
  occurredAt: Timestamp,
});

export type ServerEvent = Static<typeof ServerEvent>;
