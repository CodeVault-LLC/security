import { Type, type Static } from "@sinclair/typebox";

import {
  ActorSummary,
  CaseProfileSchema,
  CaseStatusSchema,
  HumanReference,
  Markdown,
  PaginationQuery,
  RevisionField,
  ShortText,
  Timestamp,
  Uuid,
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

export const CaseMember = Type.Object({
  user: ActorSummary,
  access: Type.Union([Type.Literal("READ"), Type.Literal("WRITE")]),
  addedAt: Timestamp,
});

export type CaseMember = Static<typeof CaseMember>;

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

export const CaseDetail = Type.Composite([
  CaseSummary,
  Type.Object({
    members: Type.Array(CaseMember),
    policyPackIds: Type.Array(Type.String()),
  }),
]);

export type CaseDetail = Static<typeof CaseDetail>;

export const ListCasesQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    status: Type.Optional(CaseStatusSchema),
    profile: Type.Optional(CaseProfileSchema),
    ownerId: Type.Optional(Uuid),
    query: Type.Optional(Type.String({ maxLength: 200 })),
  }),
]);

export type ListCasesQuery = Static<typeof ListCasesQuery>;

export const AddCaseMemberRequest = Type.Object({
  userId: Uuid,
  access: Type.Union([Type.Literal("READ"), Type.Literal("WRITE")]),
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
