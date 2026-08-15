import { Type, type Static } from "@sinclair/typebox";

import {
  ActorSummary,
  ContentVisibilitySchema,
  HumanReference,
  Markdown,
  ReportAudienceSchema,
  ReviewStateSchema,
  RevisionField,
  Sha256,
  ShortText,
  Timestamp,
  TlpLabelSchema,
  Uuid,
} from "./common.js";

/**
 * Report contracts.
 *
 * A report is a projection of the case for one audience, assembled from
 * independently reviewable sections. Markdown is canonical; HTML and PDF are
 * generated representations that never feed back into the source.
 */

export const LintSeveritySchema = Type.Union([
  Type.Literal("INFO"),
  Type.Literal("WARNING"),
  Type.Literal("ERROR"),
  Type.Literal("BLOCKING"),
]);

export type LintSeverity = Static<typeof LintSeveritySchema>;

export const LintFinding = Type.Object({
  ruleId: Type.String(),
  severity: LintSeveritySchema,
  message: Type.String(),
  sectionId: Type.Union([Uuid, Type.Null()]),
  sectionTitle: Type.Union([Type.String(), Type.Null()]),
  /** 1-indexed line within the section's Markdown, when locatable. */
  line: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  excerpt: Type.Union([Type.String(), Type.Null()]),
});

export type LintFinding = Static<typeof LintFinding>;

export const LintResult = Type.Object({
  findings: Type.Array(LintFinding),
  blocking: Type.Boolean(),
  checkedAt: Timestamp,
});

export type LintResult = Static<typeof LintResult>;

export const ReportSection = Type.Object({
  id: Uuid,
  reportId: Uuid,
  key: Type.String({ maxLength: 80 }),
  title: Type.String(),
  /** Ordering within the report outline. */
  position: Type.Integer({ minimum: 0 }),
  required: Type.Boolean(),
  contentMarkdown: Markdown,
  reviewState: ReviewStateSchema,
  /** Purpose statement from the template, shown above the editor. */
  promptPurpose: Type.Union([Type.String(), Type.Null()]),
  approvedBy: Type.Union([ActorSummary, Type.Null()]),
  approvedAt: Type.Union([Timestamp, Type.Null()]),
  approvedRevision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  lastEditedBy: Type.Union([ActorSummary, Type.Null()]),
  /** Source records whose change invalidates this section's approval. */
  sourceRefs: Type.Array(Type.String({ maxLength: 64 })),
  updatedAt: Timestamp,
  revision: RevisionField,
});

export type ReportSection = Static<typeof ReportSection>;

export const ReportSummary = Type.Object({
  id: Uuid,
  ref: HumanReference,
  caseId: Uuid,
  audience: ReportAudienceSchema,
  templateId: Type.String(),
  title: Type.String(),
  tlp: TlpLabelSchema,
  visibilityCeiling: ContentVisibilitySchema,
  status: Type.Union([
    Type.Literal("DRAFT"),
    Type.Literal("IN_REVIEW"),
    Type.Literal("APPROVED"),
    Type.Literal("PUBLISHED"),
  ]),
  sectionCount: Type.Integer({ minimum: 0 }),
  approvedSectionCount: Type.Integer({ minimum: 0 }),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: RevisionField,
});

export type ReportSummary = Static<typeof ReportSummary>;

export const ReportDetail = Type.Composite([
  ReportSummary,
  Type.Object({
    sections: Type.Array(ReportSection),
    approvals: Type.Array(
      Type.Object({
        id: Uuid,
        approvedBy: ActorSummary,
        approvedAt: Timestamp,
        note: Type.Union([Type.String(), Type.Null()]),
      }),
    ),
  }),
]);

export type ReportDetail = Static<typeof ReportDetail>;

export const CreateReportRequest = Type.Object({
  caseId: Uuid,
  audience: ReportAudienceSchema,
  templateId: Type.Optional(Type.String({ maxLength: 80 })),
  title: Type.Optional(ShortText),
});

export type CreateReportRequest = Static<typeof CreateReportRequest>;

export const UpdateReportRequest = Type.Object({
  title: Type.Optional(ShortText),
  tlp: Type.Optional(TlpLabelSchema),
  expectedRevision: RevisionField,
});

export type UpdateReportRequest = Static<typeof UpdateReportRequest>;

export const UpdateReportSectionRequest = Type.Object({
  contentMarkdown: Type.Optional(Markdown),
  reviewState: Type.Optional(ReviewStateSchema),
  title: Type.Optional(ShortText),
  expectedRevision: RevisionField,
});

export type UpdateReportSectionRequest = Static<
  typeof UpdateReportSectionRequest
>;

export const ApproveReportRequest = Type.Object({
  note: Type.Optional(Type.String({ maxLength: 1_000 })),
  expectedRevision: RevisionField,
});

export type ApproveReportRequest = Static<typeof ApproveReportRequest>;

export const ReportRevision = Type.Object({
  id: Uuid,
  sectionId: Uuid,
  revision: Type.Integer({ minimum: 1 }),
  contentMarkdown: Markdown,
  authoredBy: ActorSummary,
  /** Set when the revision came from an accepted AI proposal. */
  aiRunId: Type.Union([Uuid, Type.Null()]),
  createdAt: Timestamp,
});

export type ReportRevision = Static<typeof ReportRevision>;

export const ReportExport = Type.Object({
  id: Uuid,
  reportId: Uuid,
  format: Type.Union([Type.Literal("PDF"), Type.Literal("MARKDOWN")]),
  status: Type.Union([
    Type.Literal("QUEUED"),
    Type.Literal("RUNNING"),
    Type.Literal("COMPLETED"),
    Type.Literal("FAILED"),
  ]),
  artifactId: Type.Union([Uuid, Type.Null()]),
  sha256: Type.Union([Sha256, Type.Null()]),
  tlp: TlpLabelSchema,
  templateVersion: Type.String(),
  failureReason: Type.Union([Type.String(), Type.Null()]),
  requestedBy: ActorSummary,
  createdAt: Timestamp,
  completedAt: Type.Union([Timestamp, Type.Null()]),
});

export type ReportExport = Static<typeof ReportExport>;

export const CreateReportExportRequest = Type.Object({
  format: Type.Union([Type.Literal("PDF"), Type.Literal("MARKDOWN")]),
});

export type CreateReportExportRequest = Static<
  typeof CreateReportExportRequest
>;

/** Rendered preview, produced on demand and never stored as canonical data. */
export const ReportPreview = Type.Object({
  html: Type.String(),
  lint: LintResult,
  tlp: TlpLabelSchema,
});

export type ReportPreview = Static<typeof ReportPreview>;

export const ReportTemplateSummary = Type.Object({
  id: Type.String(),
  name: Type.String(),
  audience: ReportAudienceSchema,
  defaultTlp: TlpLabelSchema,
  visibilityCeiling: ContentVisibilitySchema,
  sections: Type.Array(
    Type.Object({
      key: Type.String(),
      title: Type.String(),
      required: Type.Boolean(),
      promptPurpose: Type.String(),
    }),
  ),
});

export type ReportTemplateSummary = Static<typeof ReportTemplateSummary>;
