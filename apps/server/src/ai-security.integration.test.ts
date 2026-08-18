import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  AiContextPreview,
  AiRunWithProposals,
  CaseDetail,
  Evidence,
  FindingDetail,
  PreparedAiRun,
  ReportDetail,
  SubmissionDetail,
} from "@codevault/contracts";
import { generateObjectKey, uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "./testing/harness.js";

/**
 * AI security.
 *
 * The whole product rests on two claims: nothing a model may not see reaches
 * it, and nothing a model produces changes canonical data without a person
 * accepting it. Everything below is an attempt to break one of those.
 */

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

const SENTINEL = "INTERNAL_SECRET_SENTINEL";

describeIntegration("AI context filtering", () => {
  let harness: TestHarness;
  let user: TestUser;
  let researchCase: CaseDetail;
  let finding: FindingDetail;
  let report: ReportDetail;
  let submission: SubmissionDetail;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser({ role: "MEMBER" });

    // The provider is enabled with the widest possible policy, so anything the
    // tests catch is the audience rule doing the work rather than the policy.
    await harness.dbHandle.db
      .insert(schema.aiProviderPolicies)
      .values({
        organizationId: harness.organizationId,
        providerId: "claude-code",
        enabled: true,
        allowedVisibility: ["INTERNAL", "VENDOR", "PUBLIC"],
        allowRestrictedCases: true,
        retainFullPrompts: true,
        allowedModels: ["claude-opus-5"],
        allowedEfforts: ["low", "medium", "high", "xhigh", "max"],
        defaultModel: "claude-opus-5",
      })
      .onConflictDoUpdate({
        target: [
          schema.aiProviderPolicies.organizationId,
          schema.aiProviderPolicies.providerId,
        ],
        set: {
          enabled: true,
          allowedVisibility: ["INTERNAL", "VENDOR", "PUBLIC"],
          allowRestrictedCases: true,
          retainFullPrompts: true,
          allowedModels: ["claude-opus-5"],
          allowedEfforts: ["low", "medium", "high", "xhigh", "max"],
          defaultModel: "claude-opus-5",
        },
      });

    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: { title: "Leak test", profile: "COORDINATED_DISCLOSURE" },
    });

    researchCase = created.json<CaseDetail>();

    const createdFinding = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: user.headers,
      payload: {
        caseId: researchCase.id,
        title: "Template injection in the export endpoint",
        summaryMarkdown: "A template parameter is evaluated server-side.",
      },
    });

    finding = createdFinding.json<FindingDetail>();

    // Internal evidence carrying the sentinel, attached to the case.
    const artifactId = uuidv7();

    await harness.dbHandle.db.insert(schema.artifacts).values({
      id: artifactId,
      caseId: researchCase.id,
      filename: "exploit-notes.txt",
      objectKey: generateObjectKey(researchCase.id, artifactId),
      mimeType: "text/plain",
      sizeBytes: 128,
      sha256: "a".repeat(64),
      artifactKind: "SOURCE_CODE",
      visibility: "INTERNAL",
      status: "STORED",
      previewKind: "TEXT_EXCERPT",
      previewText: `Working chain. Key material: ${SENTINEL}`,
      uploadedBy: user.id,
    });

    const evidence = await harness.app.inject({
      method: "POST",
      url: "/v1/evidence",
      headers: user.headers,
      payload: {
        caseId: researchCase.id,
        findingId: finding.id,
        title: `Internal exploitation notes ${SENTINEL}`,
        descriptionMarkdown: `Contains ${SENTINEL}.`,
        visibility: "INTERNAL",
        artifactIds: [artifactId],
      },
    });

    expect(evidence.statusCode).toBe(200);
    expect(evidence.json<Evidence>().visibility).toBe("INTERNAL");

    const createdReport = await harness.app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: user.headers,
      payload: { caseId: researchCase.id, audience: "PUBLIC" },
    });

    report = createdReport.json<ReportDetail>();

    const vendorResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/vendors",
      headers: user.headers,
      payload: { name: `AI security vendor ${uuidv7()}` },
    });
    const vendor = vendorResponse.json<{ id: string }>();
    const routeResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/routes`,
      headers: user.headers,
      payload: {
        name: "Security portal",
        type: "MANUAL",
        destinationUrl: "https://security.example.test/report",
        fieldMappings: [
          {
            key: "description",
            label: "Description",
            required: true,
            format: "MULTILINE_TEXT",
            submissionField: "reproduction",
            helpText: null,
          },
        ],
        acceptedExtensions: [".pdf"],
        maximumFileBytes: 1_000_000,
        maximumFileCount: 2,
        acknowledgementBusinessDays: 5,
        updateCadenceDays: null,
        instructions: null,
      },
    });
    const route = routeResponse.json<{ id: string }>();
    const submissionResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${researchCase.id}/submissions`,
      headers: user.headers,
      payload: { vendorId: vendor.id, routeId: route.id, cryptoMode: "PLAIN" },
    });
    submission = submissionResponse.json<SubmissionDetail>();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("never sends internal evidence into a public report context", async () => {
    const section = report.sections[0];

    expect(section).toBeDefined();

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/ai/context-preview",
      headers: user.headers,
      payload: {
        action: "REPORT_DRAFT_SECTION",
        targetType: "REPORT_SECTION",
        targetId: section?.id,
      },
    });

    expect(response.statusCode).toBe(200);

    const preview = response.json<AiContextPreview>();

    expect(preview.audience).toBe("PUBLIC");
    expect(preview.promptText).not.toContain(SENTINEL);

    for (const item of preview.items) {
      expect(item.visibility).toBe("PUBLIC");
      expect(item.label).not.toContain(SENTINEL);
    }
  });

  it("never sends INTERNAL evidence into vendor submission drafting", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/ai/context-preview",
      headers: user.headers,
      payload: {
        action: "SUBMISSION_DRAFT_INITIAL",
        targetType: "SUBMISSION",
        targetId: submission.id,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const preview = response.json<AiContextPreview>();
    expect(preview.audience).toBe("VENDOR");
    expect(preview.promptText).not.toContain(SENTINEL);
    expect(preview.items.every((item) => item.visibility !== "INTERNAL")).toBe(
      true,
    );
  });

  it("records what it excluded and why", async () => {
    const section = report.sections[0];

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/ai/context-preview",
      headers: user.headers,
      payload: {
        action: "REPORT_DRAFT_SECTION",
        targetType: "REPORT_SECTION",
        targetId: section?.id,
      },
    });

    const preview = response.json<AiContextPreview>();
    const excluded = preview.excluded.map((item) => item.label).join(" ");

    expect(preview.excluded.length).toBeGreaterThan(0);
    expect(excluded).toContain(SENTINEL);
  });

  it("keeps the sentinel out of the prompt a public run would send", async () => {
    const section = report.sections[0];

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/ai/runs",
      headers: user.headers,
      payload: {
        action: "REPORT_DRAFT_SECTION",
        targetType: "REPORT_SECTION",
        targetId: section?.id,
      },
    });

    expect(response.statusCode).toBe(200);

    const prepared = response.json<PreparedAiRun>();

    expect(prepared.promptText).not.toContain(SENTINEL);

    for (const item of prepared.contextManifest) {
      expect(item.visibility).toBe("PUBLIC");
    }
  });

  it("does include internal material in an internal finding context", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/ai/context-preview",
      headers: user.headers,
      payload: {
        action: "FINDING_DRAFT_TECHNICAL",
        targetType: "FINDING",
        targetId: finding.id,
      },
    });

    const preview = response.json<AiContextPreview>();

    expect(preview.audience).toBe("INTERNAL");
    expect(preview.promptText).toContain(SENTINEL);
  });

  it("refuses a run when the provider is disabled", async () => {
    await harness.dbHandle.db
      .update(schema.aiProviderPolicies)
      .set({ enabled: false })
      .where(eq(schema.aiProviderPolicies.providerId, "claude-code"));

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/ai/runs",
      headers: user.headers,
      payload: {
        action: "FINDING_DRAFT_SUMMARY",
        targetType: "FINDING",
        targetId: finding.id,
      },
    });

    expect(response.statusCode).toBe(503);

    await harness.dbHandle.db
      .update(schema.aiProviderPolicies)
      .set({ enabled: true })
      .where(eq(schema.aiProviderPolicies.providerId, "claude-code"));
  });

  it("refuses a run whose action does not match the target type", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/ai/runs",
      headers: user.headers,
      payload: {
        action: "FINDING_DRAFT_SUMMARY",
        targetType: "REPORT_SECTION",
        targetId: report.sections[0]?.id,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses an action that does not exist", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/ai/runs",
      headers: user.headers,
      payload: {
        action: "SHELL_EXEC",
        targetType: "FINDING",
        targetId: finding.id,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("stores a prompt hash even when the text is not retained", async () => {
    await harness.dbHandle.db
      .update(schema.aiProviderPolicies)
      .set({ retainFullPrompts: false })
      .where(eq(schema.aiProviderPolicies.providerId, "claude-code"));

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/ai/runs",
      headers: user.headers,
      payload: {
        action: "FINDING_DRAFT_SUMMARY",
        targetType: "FINDING",
        targetId: finding.id,
      },
    });

    const prepared = response.json<PreparedAiRun>();

    const stored = await harness.dbHandle.db
      .select({
        promptText: schema.aiRuns.promptText,
        promptSha256: schema.aiRuns.promptSha256,
      })
      .from(schema.aiRuns)
      .where(eq(schema.aiRuns.id, prepared.id))
      .limit(1);

    expect(stored[0]?.promptText).toBeNull();
    expect(stored[0]?.promptSha256).toMatch(/^[0-9a-f]{64}$/);

    await harness.dbHandle.db
      .update(schema.aiProviderPolicies)
      .set({ retainFullPrompts: true })
      .where(eq(schema.aiProviderPolicies.providerId, "claude-code"));
  });
});

describeIntegration("AI proposals", () => {
  let harness: TestHarness;
  let user: TestUser;
  let finding: FindingDetail;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser({ role: "MEMBER" });

    await harness.dbHandle.db
      .insert(schema.aiProviderPolicies)
      .values({
        organizationId: harness.organizationId,
        providerId: "claude-code",
        enabled: true,
        allowedVisibility: ["INTERNAL", "VENDOR", "PUBLIC"],
        allowRestrictedCases: true,
        retainFullPrompts: false,
        allowedModels: ["claude-opus-5"],
        allowedEfforts: ["low", "medium", "high", "xhigh", "max"],
        defaultModel: "claude-opus-5",
      })
      .onConflictDoUpdate({
        target: [
          schema.aiProviderPolicies.organizationId,
          schema.aiProviderPolicies.providerId,
        ],
        set: {
          enabled: true,
          allowedModels: ["claude-opus-5"],
          allowedEfforts: ["low", "medium", "high", "xhigh", "max"],
          defaultModel: "claude-opus-5",
        },
      });

    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: { title: "Proposals", profile: "STANDARD" },
    });

    const createdFinding = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: user.headers,
      payload: {
        caseId: created.json<CaseDetail>().id,
        title: "Proposal target",
      },
    });

    finding = createdFinding.json<FindingDetail>();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function prepareRun(action: string): Promise<PreparedAiRun> {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/ai/runs",
      headers: user.headers,
      payload: { action, targetType: "FINDING", targetId: finding.id },
    });

    expect(response.statusCode).toBe(200);

    return response.json<PreparedAiRun>();
  }

  it("records malformed provider output as a failed run, not a proposal", async () => {
    const run = await prepareRun("FINDING_DRAFT_SUMMARY");

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/ai/runs/${run.id}/result`,
      headers: user.headers,
      payload: {
        status: "COMPLETED",
        output: "I think this is a SQL injection. Probably critical.",
      },
    });

    expect(response.statusCode).toBe(422);

    const stored = await harness.dbHandle.db
      .select({ status: schema.aiRuns.status })
      .from(schema.aiRuns)
      .where(eq(schema.aiRuns.id, run.id))
      .limit(1);

    expect(stored[0]?.status).toBe("FAILED");

    const proposals = await harness.dbHandle.db
      .select({ id: schema.aiProposals.id })
      .from(schema.aiProposals)
      .where(eq(schema.aiProposals.runId, run.id));

    expect(proposals).toHaveLength(0);
  });

  it("rejects output whose shape does not match the action", async () => {
    const run = await prepareRun("FINDING_SUGGEST_CWE");

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/ai/runs/${run.id}/result`,
      headers: user.headers,
      payload: {
        status: "COMPLETED",
        output: JSON.stringify({ markdown: "not a CWE list" }),
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it("accepts a well-formed draft as a pending proposal", async () => {
    const run = await prepareRun("FINDING_DRAFT_SUMMARY");

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/ai/runs/${run.id}/result`,
      headers: user.headers,
      payload: {
        status: "COMPLETED",
        output: JSON.stringify({
          markdown: "An unauthenticated request reaches the template engine.",
          sourceIds: [],
          uncertainties: [],
          rationale: "Drawn from the finding's own description.",
        }),
      },
    });

    expect(response.statusCode).toBe(200);

    const submitted = response.json<AiRunWithProposals>();

    expect(submitted.status).toBe("COMPLETED");
    expect(submitted.proposals).toHaveLength(1);
    expect(submitted.proposals[0]?.status).toBe("PENDING");
    expect(Object.keys(submitted.proposals[0]?.patch ?? {})).toEqual([
      "summaryMarkdown",
    ]);
  });

  it("does not change the finding until a person accepts the proposal", async () => {
    const run = await prepareRun("FINDING_DRAFT_IMPACT");

    await harness.app.inject({
      method: "POST",
      url: `/v1/ai/runs/${run.id}/result`,
      headers: user.headers,
      payload: {
        status: "COMPLETED",
        output: JSON.stringify({
          markdown: "Full compromise of the application server.",
          sourceIds: [],
          uncertainties: [],
          rationale: "…",
        }),
      },
    });

    const current = await harness.app.inject({
      method: "GET",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
    });

    expect(current.json<FindingDetail>().impactMarkdown).toBeNull();
  });

  it("refuses a proposal computed against an older revision", async () => {
    const run = await prepareRun("FINDING_DRAFT_TECHNICAL");

    const submitted = await harness.app.inject({
      method: "POST",
      url: `/v1/ai/runs/${run.id}/result`,
      headers: user.headers,
      payload: {
        status: "COMPLETED",
        output: JSON.stringify({
          markdown: "The template engine evaluates the parameter.",
          sourceIds: [],
          uncertainties: [],
          rationale: "…",
        }),
      },
    });

    const proposal = submitted.json<AiRunWithProposals>().proposals[0];

    expect(proposal).toBeDefined();

    // A researcher edits the finding after the proposal was prepared.
    const before = await harness.app.inject({
      method: "GET",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
    });

    const revision = before.json<FindingDetail>().revision;

    await harness.app.inject({
      method: "PATCH",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
      payload: {
        technicalMarkdown: "Written by hand while the model was thinking.",
        expectedRevision: revision,
      },
    });

    const accepted = await harness.app.inject({
      method: "POST",
      url: `/v1/ai/proposals/${proposal?.id}/accept`,
      headers: user.headers,
      payload: { expectedRevision: revision + 1 },
    });

    expect(accepted.statusCode).toBe(409);
    expect(
      accepted.json<{ error: { message: string } }>().error.message,
    ).toContain("changed since the AI proposal was created");

    const after = await harness.app.inject({
      method: "GET",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
    });

    expect(after.json<FindingDetail>().technicalMarkdown).toBe(
      "Written by hand while the model was thinking.",
    );
  });

  it("refuses an accepted patch that reaches beyond the action's fields", async () => {
    const run = await prepareRun("FINDING_DRAFT_SUMMARY");

    const submitted = await harness.app.inject({
      method: "POST",
      url: `/v1/ai/runs/${run.id}/result`,
      headers: user.headers,
      payload: {
        status: "COMPLETED",
        output: JSON.stringify({
          markdown: "A summary.",
          sourceIds: [],
          uncertainties: [],
          rationale: "…",
        }),
      },
    });

    const proposal = submitted.json<AiRunWithProposals>().proposals[0];
    const current = await harness.app.inject({
      method: "GET",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
    });

    const revision = current.json<FindingDetail>().revision;

    // The researcher's "edited" patch tries to smuggle in a state change.
    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/ai/proposals/${proposal?.id}/accept`,
      headers: user.headers,
      payload: {
        expectedRevision: revision,
        patch: {
          summaryMarkdown: "A summary.",
          priorArtState: "HUMAN_CONFIRMED_NOVEL",
        },
      },
    });

    expect(response.statusCode).toBe(422);

    const after = await harness.app.inject({
      method: "GET",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
    });

    expect(after.json<FindingDetail>().priorArtState).toBe("UNCHECKED");
  });

  it("refuses a proposal that tries to change validation state", async () => {
    const run = await prepareRun("FINDING_DRAFT_SUMMARY");

    const submitted = await harness.app.inject({
      method: "POST",
      url: `/v1/ai/runs/${run.id}/result`,
      headers: user.headers,
      payload: {
        status: "COMPLETED",
        output: JSON.stringify({
          markdown: "A summary.",
          sourceIds: [],
          uncertainties: [],
          rationale: "…",
        }),
      },
    });

    const proposal = submitted.json<AiRunWithProposals>().proposals[0];
    const current = await harness.app.inject({
      method: "GET",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
    });

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/ai/proposals/${proposal?.id}/accept`,
      headers: user.headers,
      payload: {
        expectedRevision: current.json<FindingDetail>().revision,
        patch: { validationState: "CONFIRMED" },
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it("lets only the person who started a run report its result", async () => {
    const other = await harness.createUser({ role: "MEMBER" });
    const run = await prepareRun("FINDING_DRAFT_SUMMARY");

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/ai/runs/${run.id}/result`,
      headers: other.headers,
      payload: { status: "FAILED", failureReason: "hijack attempt" },
    });

    expect(response.statusCode).toBe(403);
  });
});

describeIntegration("prior-art conclusions", () => {
  let harness: TestHarness;
  let user: TestUser;
  let finding: FindingDetail;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser({ role: "MEMBER" });

    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: { title: "Prior art", profile: "STANDARD" },
    });

    const createdFinding = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: user.headers,
      payload: {
        caseId: created.json<CaseDetail>().id,
        title: "Novel-looking finding",
      },
    });

    finding = createdFinding.json<FindingDetail>();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("starts unchecked and stays unchecked until someone concludes", async () => {
    expect(finding.priorArtState).toBe("UNCHECKED");

    const started = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/prior-art-checks`,
      headers: user.headers,
      payload: {},
    });

    expect(started.statusCode).toBe(200);

    const after = await harness.app.inject({
      method: "GET",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
    });

    expect(after.json<FindingDetail>().priorArtState).toBe("UNCHECKED");
  });

  it("refuses a conclusion while the check is still running", async () => {
    const started = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/prior-art-checks`,
      headers: user.headers,
      payload: {},
    });

    const check = started.json<{ id: string }>();

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/prior-art-checks/${check.id}/conclude`,
      headers: user.headers,
      payload: { conclusion: "NO_PRIOR_ART_FOUND" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("records a human conclusion of novel, with the person who made it", async () => {
    const started = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/prior-art-checks`,
      headers: user.headers,
      payload: {},
    });

    const check = started.json<{ id: string }>();

    await harness.dbHandle.db
      .update(schema.priorArtChecks)
      .set({ status: "COMPLETED" })
      .where(eq(schema.priorArtChecks.id, check.id));

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/prior-art-checks/${check.id}/conclude`,
      headers: user.headers,
      payload: { conclusion: "HUMAN_CONFIRMED_NOVEL" },
    });

    expect(response.statusCode).toBe(200);

    const concluded = response.json<{
      humanConclusion: string;
      concludedBy: { id: string } | null;
    }>();

    expect(concluded.humanConclusion).toBe("HUMAN_CONFIRMED_NOVEL");
    expect(concluded.concludedBy?.id).toBe(user.id);

    const audit = await harness.dbHandle.db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, finding.id));

    expect(audit.map((row) => row.action)).toContain(
      "prior_art.human_confirmed_novel",
    );
  });
});
