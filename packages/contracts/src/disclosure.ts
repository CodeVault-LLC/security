import { Type, type Static } from "@sinclair/typebox";

import {
  ActorSummary,
  ContentVisibilitySchema,
  DisclosureEventTypeSchema,
  Markdown,
  RevisionField,
  ShortText,
  Timestamp,
  Uuid,
} from "./common.js";

/**
 * Disclosure coordination contracts.
 *
 * The timeline is structured data first. Report timelines are generated from
 * these events so the vendor report and the public advisory cannot drift apart.
 */

export const Stakeholder = Type.Object({
  id: Uuid,
  caseId: Uuid,
  name: Type.String(),
  organisation: Type.Union([Type.String(), Type.Null()]),
  role: Type.Union([
    Type.Literal("VENDOR_SECURITY"),
    Type.Literal("VENDOR_ENGINEERING"),
    Type.Literal("CNA"),
    Type.Literal("CERT"),
    Type.Literal("PROGRAM"),
    Type.Literal("OTHER"),
  ]),
  email: Type.Union([Type.String(), Type.Null()]),
  /** PGP fingerprint or other secure-channel detail, when supplied. */
  secureChannel: Type.Union([Type.String(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  createdAt: Timestamp,
});

export type Stakeholder = Static<typeof Stakeholder>;

export const CreateStakeholderRequest = Type.Object({
  name: ShortText,
  organisation: Type.Optional(Type.String({ maxLength: 200 })),
  role: Type.Union([
    Type.Literal("VENDOR_SECURITY"),
    Type.Literal("VENDOR_ENGINEERING"),
    Type.Literal("CNA"),
    Type.Literal("CERT"),
    Type.Literal("PROGRAM"),
    Type.Literal("OTHER"),
  ]),
  email: Type.Optional(Type.String({ format: "email", maxLength: 320 })),
  secureChannel: Type.Optional(Type.String({ maxLength: 300 })),
  notes: Type.Optional(Type.String({ maxLength: 2_000 })),
});

export type CreateStakeholderRequest = Static<typeof CreateStakeholderRequest>;

export const DisclosureEvent = Type.Object({
  id: Uuid,
  caseId: Uuid,
  findingId: Type.Union([Uuid, Type.Null()]),
  type: DisclosureEventTypeSchema,
  /** Required for CUSTOM events, optional elsewhere. */
  label: Type.Union([Type.String(), Type.Null()]),
  occurredAt: Timestamp,
  detailMarkdown: Type.Union([Markdown, Type.Null()]),
  stakeholderId: Type.Union([Uuid, Type.Null()]),
  stakeholderName: Type.Union([Type.String(), Type.Null()]),
  /** Correspondence attached as evidence of this step. */
  artifactIds: Type.Array(Uuid),
  visibility: ContentVisibilitySchema,
  recordedBy: ActorSummary,
  createdAt: Timestamp,
});

export type DisclosureEvent = Static<typeof DisclosureEvent>;

export const CreateDisclosureEventRequest = Type.Object({
  type: DisclosureEventTypeSchema,
  label: Type.Optional(Type.String({ maxLength: 200 })),
  occurredAt: Timestamp,
  detailMarkdown: Type.Optional(Markdown),
  findingId: Type.Optional(Uuid),
  stakeholderId: Type.Optional(Uuid),
  artifactIds: Type.Optional(Type.Array(Uuid)),
  visibility: ContentVisibilitySchema,
});

export type CreateDisclosureEventRequest = Static<
  typeof CreateDisclosureEventRequest
>;

export const Embargo = Type.Object({
  id: Uuid,
  caseId: Uuid,
  startsAt: Type.Union([Timestamp, Type.Null()]),
  endsAt: Type.Union([Timestamp, Type.Null()]),
  plannedDisclosureAt: Type.Union([Timestamp, Type.Null()]),
  expectedResponseAt: Type.Union([Timestamp, Type.Null()]),
  agreementNote: Type.Union([Type.String(), Type.Null()]),
  updatedBy: ActorSummary,
  updatedAt: Timestamp,
  revision: RevisionField,
});

export type Embargo = Static<typeof Embargo>;

export const SetEmbargoRequest = Type.Object({
  startsAt: Type.Optional(Type.Union([Timestamp, Type.Null()])),
  endsAt: Type.Optional(Type.Union([Timestamp, Type.Null()])),
  plannedDisclosureAt: Type.Optional(Type.Union([Timestamp, Type.Null()])),
  expectedResponseAt: Type.Optional(Type.Union([Timestamp, Type.Null()])),
  agreementNote: Type.Optional(Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()])),
});

export type SetEmbargoRequest = Static<typeof SetEmbargoRequest>;

export const DisclosureOverview = Type.Object({
  caseId: Uuid,
  stakeholders: Type.Array(Stakeholder),
  events: Type.Array(DisclosureEvent),
  embargo: Type.Union([Embargo, Type.Null()]),
  /** Derived warnings such as an approaching planned disclosure date. */
  warnings: Type.Array(
    Type.Object({
      code: Type.String(),
      message: Type.String(),
      dueAt: Type.Union([Timestamp, Type.Null()]),
    }),
  ),
});

export type DisclosureOverview = Static<typeof DisclosureOverview>;
