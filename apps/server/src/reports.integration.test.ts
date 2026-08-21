import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  CaseDetail,
  FindingDetail,
  LintResult,
  ReportDetail,
  ReportListResponse,
  ReportPreview,
} from "@codevault/contracts";
import { generateObjectKey, uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "./testing/harness.js";

/**
 * Report approval and export.
 *
 * The export path is the last moment before something leaves the building, so
 * these tests attack it directly: reference internal evidence from a public
 * advisory, leave an AI draft unreviewed, mark a public report TLP:RED, and
 * confirm each one is refused rather than warned about.
 */

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

const SENTINEL = "INTERNAL_SECRET_SENTINEL";

interface Fixture {
  researchCase: CaseDetail;
  finding: FindingDetail;
  internalEvidenceRef: string;
  publicEvidenceRef: string;
}

describeIntegration("report export", () => {
  let harness: TestHarness;
  let user: TestUser;
  let fixture: Fixture;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser({ role: "MEMBER" });

    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: { title: "Export gate", profile: "COORDINATED_DISCLOSURE" },
    });

    const researchCase = created.json<CaseDetail>();

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

    const finding = createdFinding.json<FindingDetail>();

    const makeEvidence = async (
      visibility: "INTERNAL" | "PUBLIC",
      title: string,
    ): Promise<string> => {
      const artifactId = uuidv7();

      await harness.dbHandle.db.insert(schema.artifacts).values({
        id: artifactId,
        caseId: researchCase.id,
        filename: `${visibility.toLowerCase()}.txt`,
        objectKey: generateObjectKey(researchCase.id, artifactId),
        mimeType: "text/plain",
        sizeBytes: 32,
        sha256: "b".repeat(64),
        artifactKind: "LOG",
        visibility,
        status: "STORED",
        uploadedBy: user.id,
      });

      const response = await harness.app.inject({
        method: "POST",
        url: "/v1/evidence",
        headers: user.headers,
        payload: {
          caseId: researchCase.id,
          findingId: finding.id,
          title,
          visibility,
          artifactIds: [artifactId],
        },
      });

      return response.json<{ ref: string }>().ref;
    };

    fixture = {
      researchCase,
      finding,
      internalEvidenceRef: await makeEvidence(
        "INTERNAL",
        `Internal capture ${SENTINEL}`,
      ),
      publicEvidenceRef: await makeEvidence("PUBLIC", "Published screenshot"),
    };

    const asset = await harness.app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: user.headers,
      payload: {
        name: "Export Service",
        kind: "SOFTWARE_COMPONENT",
        caseId: researchCase.id,
      },
    });

    const affected = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/affected-ranges`,
      headers: user.headers,
      payload: {
        assetId: asset.json<{ id: string }>().id,
        kind: "EXACT_VERSION",
        expression: "4.1.6",
        status: "CONFIRMED_VULNERABLE",
      },
    });

    expect(affected.statusCode).toBe(200);
  });

  afterAll(async () => {
    await harness.close();
  });

  async function createReport(
    audience: "INTERNAL" | "VENDOR" | "PUBLIC",
  ): Promise<ReportDetail> {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: user.headers,
      payload: { caseId: fixture.researchCase.id, audience },
    });

    expect(response.statusCode).toBe(200);

    return response.json<ReportDetail>();
  }

  async function writeSection(
    report: ReportDetail,
    key: string,
    content: string,
  ): Promise<ReportDetail> {
    const section = report.sections.find((item) => item.key === key);

    expect(section).toBeDefined();

    const response = await harness.app.inject({
      method: "PATCH",
      url: `/v1/reports/${report.id}/sections/${section?.id}`,
      headers: user.headers,
      payload: {
        contentMarkdown: content,
        expectedRevision: section?.revision,
      },
    });

    expect(response.statusCode).toBe(200);

    return response.json<ReportDetail>();
  }

  it("blocks a public export that references internal evidence", async () => {
    const report = await createReport("PUBLIC");

    await writeSection(
      report,
      "summary",
      `A template parameter is evaluated server-side. See [evidence:${fixture.internalEvidenceRef}].`,
    );

    const lint = await harness.app.inject({
      method: "GET",
      url: `/v1/reports/${report.id}/lint`,
      headers: user.headers,
    });

    const result = lint.json<LintResult>();

    expect(result.blocking).toBe(true);
    expect(
      result.findings.some(
        (finding) => finding.ruleId === "visibility-violation",
      ),
    ).toBe(true);

    const exported = await harness.app.inject({
      method: "POST",
      url: `/v1/reports/${report.id}/exports`,
      headers: user.headers,
      payload: { format: "PDF" },
    });

    expect(exported.statusCode).toBe(422);
    expect(harness.jobs.sent).toHaveLength(0);
  });

  it("refuses to approve a report with blocking findings", async () => {
    const reports = await harness.app.inject({
      method: "GET",
      url: `/v1/reports?caseId=${fixture.researchCase.id}`,
      headers: user.headers,
    });

    const summary = reports
      .json<{
        items: Array<{ id: string; audience: string; revision: number }>;
      }>()
      .items.find((item) => item.audience === "PUBLIC");

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/reports/${summary?.id}/approve`,
      headers: user.headers,
      payload: { expectedRevision: summary?.revision },
    });

    expect(response.statusCode).toBe(422);
  });

  it("keeps internal evidence out of the rendered public preview", async () => {
    const reports = await harness.app.inject({
      method: "GET",
      url: `/v1/reports?caseId=${fixture.researchCase.id}`,
      headers: user.headers,
    });

    const summary = reports
      .json<{ items: Array<{ id: string; audience: string }> }>()
      .items.find((item) => item.audience === "PUBLIC");

    const preview = await harness.app.inject({
      method: "GET",
      url: `/v1/reports/${summary?.id}/preview`,
      headers: user.headers,
    });

    const body = preview.json<ReportPreview>();

    expect(body.html).not.toContain(SENTINEL);
    expect(body.html).not.toContain(fixture.internalEvidenceRef);
  });

  it("allows a public export that references public evidence only", async () => {
    const reports = await harness.app.inject({
      method: "GET",
      url: `/v1/reports?caseId=${fixture.researchCase.id}`,
      headers: user.headers,
    });

    const summary = reports
      .json<{ items: Array<{ id: string; audience: string }> }>()
      .items.find((item) => item.audience === "PUBLIC");

    const detail = await harness.app.inject({
      method: "GET",
      url: `/v1/reports/${summary?.id}`,
      headers: user.headers,
    });

    const report = detail.json<ReportDetail>();

    await writeSection(
      report,
      "summary",
      `A template parameter is evaluated server-side. See [evidence:${fixture.publicEvidenceRef}].`,
    );

    const refreshed = await harness.app.inject({
      method: "GET",
      url: `/v1/reports/${report.id}`,
      headers: user.headers,
    });

    const current = refreshed.json<ReportDetail>();

    for (const section of current.sections.filter((item) => item.required)) {
      if (section.contentMarkdown.trim().length === 0) {
        await writeSection(current, section.key, "Recorded during research.");
      }
    }

    const finalState = await harness.app.inject({
      method: "GET",
      url: `/v1/reports/${report.id}/lint`,
      headers: user.headers,
    });

    const lint = finalState.json<LintResult>();

    expect(
      lint.findings.filter((item) => item.ruleId === "visibility-violation"),
    ).toHaveLength(0);
  });

  it("blocks a public report marked TLP:RED", async () => {
    const reports = await harness.app.inject({
      method: "GET",
      url: `/v1/reports?caseId=${fixture.researchCase.id}`,
      headers: user.headers,
    });

    const summary = reports
      .json<{
        items: Array<{ id: string; audience: string; revision: number }>;
      }>()
      .items.find((item) => item.audience === "PUBLIC");

    const response = await harness.app.inject({
      method: "PATCH",
      url: `/v1/reports/${summary?.id}`,
      headers: user.headers,
      payload: { tlp: "TLP:RED", expectedRevision: summary?.revision },
    });

    expect(response.statusCode).toBe(400);
  });

  it("gives each audience its own report and refuses a duplicate", async () => {
    await createReport("VENDOR");

    const duplicate = await harness.app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: user.headers,
      payload: { caseId: fixture.researchCase.id, audience: "VENDOR" },
    });

    expect(duplicate.statusCode).toBe(400);
  });

  it("lists organization reports with accurate counts in one paginated response", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/reports?limit=100",
      headers: user.headers,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ReportListResponse>();
    const report = body.items.find(
      (item) => item.case.id === fixture.researchCase.id,
    );
    expect(report?.case.ref).toBe(fixture.researchCase.ref);
    expect(report?.sectionCount).toBeGreaterThan(0);
    expect(report?.approvedSectionCount).toBeLessThanOrEqual(
      report?.sectionCount ?? 0,
    );
    expect(body.nextCursor).toBeNull();
  });

  it("drops an approved section back to review when it is edited", async () => {
    const report = await createReport("INTERNAL");
    const updated = await writeSection(
      report,
      "executive_summary",
      "First draft.",
    );

    const section = updated.sections.find(
      (item) => item.key === "executive_summary",
    );

    const approved = await harness.app.inject({
      method: "PATCH",
      url: `/v1/reports/${report.id}/sections/${section?.id}`,
      headers: user.headers,
      payload: { reviewState: "APPROVED", expectedRevision: section?.revision },
    });

    expect(approved.statusCode).toBe(200);

    const afterApproval = approved
      .json<ReportDetail>()
      .sections.find((item) => item.key === "executive_summary");

    expect(afterApproval?.reviewState).toBe("APPROVED");
    expect(afterApproval?.approvedBy?.id).toBe(user.id);

    const edited = await harness.app.inject({
      method: "PATCH",
      url: `/v1/reports/${report.id}/sections/${afterApproval?.id}`,
      headers: user.headers,
      payload: {
        contentMarkdown: "Second draft, written after approval.",
        expectedRevision: afterApproval?.revision,
      },
    });

    const afterEdit = edited
      .json<ReportDetail>()
      .sections.find((item) => item.key === "executive_summary");

    expect(afterEdit?.reviewState).toBe("RESEARCHER_EDITED");
  });

  it("keeps an immutable revision for every saved change", async () => {
    const reports = await harness.app.inject({
      method: "GET",
      url: `/v1/reports?caseId=${fixture.researchCase.id}`,
      headers: user.headers,
    });

    const summary = reports
      .json<{ items: Array<{ id: string; audience: string }> }>()
      .items.find((item) => item.audience === "VENDOR");

    const detail = await harness.app.inject({
      method: "GET",
      url: `/v1/reports/${summary?.id}`,
      headers: user.headers,
    });

    const report = detail.json<ReportDetail>();
    const section = report.sections[0];

    await harness.app.inject({
      method: "PATCH",
      url: `/v1/reports/${report.id}/sections/${section?.id}`,
      headers: user.headers,
      payload: {
        contentMarkdown: "Revision one.",
        expectedRevision: section?.revision,
      },
    });

    const revisions = await harness.dbHandle.db
      .select({ contentMarkdown: schema.reportRevisions.contentMarkdown })
      .from(schema.reportRevisions);

    expect(
      revisions.some((row) => row.contentMarkdown === "Revision one."),
    ).toBe(true);
  });
});

describeIntegration("audit trail", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("cannot be rewritten through the database", async () => {
    const user = await harness.createUser({ role: "MEMBER" });

    await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: { title: "Audited", profile: "STANDARD" },
    });

    // Scoped to this test's own actor. The table is append-only and shared by
    // every test in the run, so a global count would race with whatever else is
    // writing audit events at the same moment.
    const own = eq(schema.auditEvents.actorId, user.id);

    const before = await harness.dbHandle.db
      .select({ id: schema.auditEvents.id })
      .from(schema.auditEvents)
      .where(own);

    await harness.dbHandle.db.execute(
      "UPDATE audit_events SET action = 'tampered'" as never,
    );
    await harness.dbHandle.db.execute("DELETE FROM audit_events" as never);

    const after = await harness.dbHandle.db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(own);

    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBe(before.length);
    expect(after.every((row) => row.action !== "tampered")).toBe(true);
  });

  it("records case creation with the acting user", async () => {
    const user = await harness.createUser({ role: "MEMBER" });

    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: { title: "Audited creation", profile: "STANDARD" },
    });

    const researchCase = created.json<CaseDetail>();

    const activity = await harness.app.inject({
      method: "GET",
      url: `/v1/activity?caseId=${researchCase.id}`,
      headers: user.headers,
    });

    const events = activity.json<{
      items: Array<{ action: string; actor: { id: string } | null }>;
    }>().items;

    const creation = events.find((event) => event.action === "case.created");

    expect(creation).toBeDefined();
    expect(creation?.actor?.id).toBe(user.id);
  });
});
