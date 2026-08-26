import { describe, expect, it } from "vitest";

import type {
  AuditEvent,
  CaseDetail,
  CaseReadiness,
  DisclosureOverview,
  FindingSummary,
} from "@codevault/contracts";

import { buildCaseHandoffBrief } from "./case-handoff-brief.js";

const researchCase: CaseDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  ref: "CASE-0042",
  title: "Parser boundary review",
  summary: "Review the archive parser before coordinated disclosure.",
  profile: "COORDINATED_DISCLOSURE",
  status: "OPEN",
  restricted: true,
  disclosureEnabled: true,
  owner: {
    id: "22222222-2222-4222-8222-222222222222",
    displayName: "Ada Researcher",
    email: "ada@example.test",
  },
  findingCount: 1,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-26T09:00:00.000Z",
  revision: 3,
  members: [],
  policyPackIds: ["coordinated-default"],
};

const finding: FindingSummary = {
  id: "33333333-3333-4333-8333-333333333333",
  ref: "FIND-0043",
  caseId: researchCase.id,
  caseRef: researchCase.ref,
  title: "Traversal through crafted archive",
  summaryMarkdown: null,
  validationState: "CONFIRMED",
  remediationState: "FIX_PROPOSED",
  disclosureState: "VENDOR_CONTACTED",
  externalIdState: "NONE",
  priorArtState: "NO_PRIOR_ART_FOUND",
  severity: "HIGH",
  score: 8.1,
  primaryAsset: null,
  pendingProposalCount: 0,
  createdAt: "2026-08-20T10:00:00.000Z",
  updatedAt: "2026-08-25T10:00:00.000Z",
  revision: 2,
};

const readiness: CaseReadiness = {
  caseId: researchCase.id,
  satisfied: false,
  requirements: [
    {
      id: "vendor-response",
      description: "Record the vendor response",
      satisfied: false,
      detail: "No acknowledgement recorded",
    },
  ],
};

const disclosure: DisclosureOverview = {
  caseId: researchCase.id,
  stakeholders: [],
  events: [],
  embargo: {
    id: "44444444-4444-4444-8444-444444444444",
    caseId: researchCase.id,
    startsAt: null,
    endsAt: "2026-09-30T12:00:00.000Z",
    plannedDisclosureAt: "2026-10-01T12:00:00.000Z",
    expectedResponseAt: "2026-08-30T12:00:00.000Z",
    agreementNote: "Provisional until acknowledgement.",
    updatedBy: researchCase.owner,
    updatedAt: "2026-08-25T11:00:00.000Z",
    revision: 1,
  },
  warnings: [
    {
      code: "VENDOR_RESPONSE_DUE",
      message: "Vendor response is due soon.",
      dueAt: "2026-08-30T12:00:00.000Z",
    },
  ],
};

const activity: AuditEvent = {
  id: "55555555-5555-4555-8555-555555555555",
  action: "finding.updated",
  entityType: "finding",
  entityId: finding.id,
  caseId: researchCase.id,
  actor: researchCase.owner,
  sessionId: null,
  requestId: null,
  aiRunId: null,
  before: null,
  after: null,
  occurredAt: "2026-08-26T08:00:00.000Z",
};

describe("case handoff brief", () => {
  it("summarizes readiness, findings, coordination dates, and activity", () => {
    const markdown = buildCaseHandoffBrief({
      researchCase,
      findings: [finding],
      readiness,
      disclosure,
      activity: [activity],
      generatedAt: "2026-08-26T12:00:00.000Z",
    });

    expect(markdown).toContain("# CASE-0042: Parser boundary review");
    expect(markdown).toContain("**Access:** Restricted");
    expect(markdown).toContain("Record the vendor response");
    expect(markdown).toContain("FIND-0043");
    expect(markdown).toContain("2026-10-01T12:00:00.000Z");
    expect(markdown).toContain("Vendor response is due soon.");
    expect(markdown).toContain("finding.updated");
    expect(markdown.endsWith("\n")).toBe(true);
  });

  it("states when optional coordination and activity data are absent", () => {
    const markdown = buildCaseHandoffBrief({
      researchCase: { ...researchCase, disclosureEnabled: false },
      findings: [],
      readiness: { ...readiness, satisfied: true, requirements: [] },
      disclosure: null,
      activity: [],
      generatedAt: "2026-08-26T12:00:00.000Z",
    });

    expect(markdown).toContain("No findings recorded.");
    expect(markdown).toContain("Disclosure coordination is not enabled.");
    expect(markdown).toContain("No recent activity recorded.");
  });
});
