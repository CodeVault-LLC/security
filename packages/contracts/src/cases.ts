import { Type, type Static } from "@sinclair/typebox";

import {
  ActorSummary,
  CaseProfileSchema,
  CaseStatusSchema,
  HumanReference,
  Markdown,
  PaginationQuery,
  PaginatedResponse,
  RevisionField,
  ShortText,
  Timestamp,
  Uuid,
  UserRoleSchema,
} from "./common.js";

/**
 * Research case contracts.
 *
 * Creating a case asks for four things at most. Everything else about the case
 * is discovered during research and edited later.
 */

export const CreateCaseRequest = Type.Object({
  title: ShortText,
  profile: CaseProfileSchema,
  summary: Type.Optional(Type.String({ maxLength: 2_000 })),
  /** Defaults to the calling user. Admins may hand a case to someone else. */
  ownerId: Type.Optional(Uuid),
  restricted: Type.Optional(Type.Boolean()),
});

export type CreateCaseRequest = Static<typeof CreateCaseRequest>;

export const DuplicateCaseRequest = Type.Object({
  title: ShortText,
  /** Reuses case-level asset links, never finding or evidence records. */
  copyAssets: Type.Optional(Type.Boolean()),
  /** Reuses explicit case members and their access levels. */
  copyMembers: Type.Optional(Type.Boolean()),
});

export type DuplicateCaseRequest = Static<typeof DuplicateCaseRequest>;

export const UpdateCaseRequest = Type.Object({
  title: Type.Optional(ShortText),
  summary: Type.Optional(Type.String({ maxLength: 2_000 })),
  profile: Type.Optional(CaseProfileSchema),
  status: Type.Optional(CaseStatusSchema),
  ownerId: Type.Optional(Uuid),
  restricted: Type.Optional(Type.Boolean()),
  /** Turns the Disclosure tab on for a case that started as STANDARD. */
  disclosureEnabled: Type.Optional(Type.Boolean()),
  expectedRevision: RevisionField,
});

export type UpdateCaseRequest = Static<typeof UpdateCaseRequest>;

export const CaseCapabilitySchema = Type.Union([
  Type.Literal("READ"),
  Type.Literal("WRITE"),
  Type.Literal("APPROVAL"),
  Type.Literal("DISCLOSURE"),
]);

export type CaseCapability = Static<typeof CaseCapabilitySchema>;

export const CaseCapabilitiesSchema = Type.Array(CaseCapabilitySchema, {
  minItems: 1,
  maxItems: 4,
  uniqueItems: true,
  contains: Type.Literal("READ"),
});

export const CaseMember = Type.Object({
  user: ActorSummary,
  capabilities: CaseCapabilitiesSchema,
  addedAt: Timestamp,
});

export type CaseMember = Static<typeof CaseMember>;

const CaseCapabilityList = Type.Array(CaseCapabilitySchema, {
  maxItems: 4,
  uniqueItems: true,
});

export const CaseAccessReviewPrincipal = Type.Object({
  user: ActorSummary,
  role: UserRoleSchema,
  disabled: Type.Boolean(),
  source: Type.Union([Type.Literal("OWNER"), Type.Literal("GRANT")]),
  /** Stored grant, or the owner's implicit grant. */
  grantedCapabilities: CaseCapabilityList,
  /** Authority after applying account state and the organization-role ceiling. */
  effectiveCapabilities: CaseCapabilityList,
  grantedAt: Type.Union([Timestamp, Type.Null()]),
});

export type CaseAccessReviewPrincipal = Static<
  typeof CaseAccessReviewPrincipal
>;

export const CaseAccessReviewItem = Type.Object({
  id: Uuid,
  ref: HumanReference,
  title: Type.String(),
  status: CaseStatusSchema,
  restricted: Type.Boolean(),
  principals: Type.Array(CaseAccessReviewPrincipal, { minItems: 1 }),
  updatedAt: Timestamp,
});

export type CaseAccessReviewItem = Static<typeof CaseAccessReviewItem>;

export const ListCaseAccessReviewQuery = Type.Object({
  ...PaginationQuery.properties,
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  query: Type.Optional(Type.String({ maxLength: 200 })),
  userId: Type.Optional(Uuid),
});

export type ListCaseAccessReviewQuery = Static<
  typeof ListCaseAccessReviewQuery
>;

export const CaseAccessReviewResponse = Type.Object({
  ...PaginatedResponse(CaseAccessReviewItem).properties,
  total: Type.Integer({ minimum: 0 }),
});

export type CaseAccessReviewResponse = Static<typeof CaseAccessReviewResponse>;

export const CaseAccessHistoryEvent = Type.Object({
  id: Uuid,
  kind: Type.Union([
    Type.Literal("GRANTED"),
    Type.Literal("UPDATED"),
    Type.Literal("REVOKED"),
    Type.Literal("OWNER_TRANSFERRED"),
    Type.Literal("LEGACY_CHANGE"),
  ]),
  actor: Type.Union([ActorSummary, Type.Null()]),
  subject: Type.Union([ActorSummary, Type.Null()]),
  previousSubject: Type.Union([ActorSummary, Type.Null()]),
  beforeCapabilities: Type.Union([CaseCapabilityList, Type.Null()]),
  afterCapabilities: Type.Union([CaseCapabilityList, Type.Null()]),
  requestId: Type.Union([Type.String(), Type.Null()]),
  occurredAt: Timestamp,
});

export type CaseAccessHistoryEvent = Static<typeof CaseAccessHistoryEvent>;

export const ListCaseAccessHistoryQuery = Type.Object({
  ...PaginationQuery.properties,
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
});

export const CaseAccessHistoryResponse = Type.Object({
  ...PaginatedResponse(CaseAccessHistoryEvent).properties,
  total: Type.Integer({ minimum: 0 }),
});

export type CaseAccessHistoryResponse = Static<
  typeof CaseAccessHistoryResponse
>;

export const CaseSummary = Type.Object({
  id: Uuid,
  ref: HumanReference,
  title: Type.String(),
  summary: Type.Union([Type.String(), Type.Null()]),
  profile: CaseProfileSchema,
  status: CaseStatusSchema,
  restricted: Type.Boolean(),
  disclosureEnabled: Type.Boolean(),
  owner: ActorSummary,
  findingCount: Type.Integer({ minimum: 0 }),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: RevisionField,
});

export type CaseSummary = Static<typeof CaseSummary>;

export const CaseDetail = Type.Object({
  ...CaseSummary.properties,
  members: Type.Array(CaseMember),
  policyPackIds: Type.Array(Type.String()),
});

export type CaseDetail = Static<typeof CaseDetail>;

export const ListCasesQuery = Type.Object({
  ...PaginationQuery.properties,
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  status: Type.Optional(CaseStatusSchema),
  profile: Type.Optional(CaseProfileSchema),
  ownerId: Type.Optional(Uuid),
  query: Type.Optional(Type.String({ maxLength: 200 })),
});

export type ListCasesQuery = Static<typeof ListCasesQuery>;

export const CaseListResponse = Type.Object({
  ...PaginatedResponse(CaseSummary).properties,
  total: Type.Integer({ minimum: 0 }),
});

export type CaseListResponse = Static<typeof CaseListResponse>;

export const AddCaseMemberRequest = Type.Object({
  userId: Uuid,
  capabilities: CaseCapabilitiesSchema,
});

export type AddCaseMemberRequest = Static<typeof AddCaseMemberRequest>;

export const CaseNote = Type.Object({
  id: Uuid,
  caseId: Uuid,
  title: Type.Union([Type.String(), Type.Null()]),
  bodyMarkdown: Markdown,
  author: ActorSummary,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export type CaseNote = Static<typeof CaseNote>;

export const CreateCaseNoteRequest = Type.Object({
  title: Type.Optional(Type.String({ maxLength: 200 })),
  bodyMarkdown: Markdown,
});

export type CreateCaseNoteRequest = Static<typeof CreateCaseNoteRequest>;

/**
 * Policy-pack readiness.
 *
 * Answers "what is still missing before this case can publish?" without
 * blocking any of the ordinary research work.
 */
export const CaseReadiness = Type.Object({
  caseId: Uuid,
  satisfied: Type.Boolean(),
  requirements: Type.Array(
    Type.Object({
      id: Type.String(),
      description: Type.String(),
      satisfied: Type.Boolean(),
      detail: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
});

export type CaseReadiness = Static<typeof CaseReadiness>;
