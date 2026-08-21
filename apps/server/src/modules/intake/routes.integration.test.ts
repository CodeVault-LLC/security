import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  CaseDetail,
  FindingDetail,
  IntakeItem,
} from "@codevault/contracts";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("finding intake", () => {
  let harness: TestHarness;
  let owner: TestUser;
  let outsider: TestUser;
  let researchCase: CaseDetail;

  beforeAll(async () => {
    harness = await createHarness();
    owner = await harness.createUser();
    outsider = await harness.createUser();

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: owner.headers,
      payload: {
        title: "Restricted intake test",
        profile: "STANDARD",
        restricted: true,
      },
    });
    researchCase = response.json<CaseDetail>();
  });

  afterAll(async () => {
    await harness.close();
  });

  const createManual = async (): Promise<IntakeItem> => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/intake/manual",
      headers: owner.headers,
      payload: {
        caseId: researchCase.id,
        sourceLabel: "Imported notebook",
        draft: {
          title: "Unauthenticated SQL injection in report export",
          summaryMarkdown: "A crafted export request reaches a SQL query.",
          technicalMarkdown: "The report filter is concatenated into SQL.",
          impactMarkdown: "An unauthenticated attacker may read report data.",
          remediationMarkdown: "Use a parameterised query.",
          suggestedCweIds: ["CWE-89"],
          affectedVersions: [],
        },
        citations: [],
        confidence: "HIGH",
      },
    });

    expect(response.statusCode).toBe(200);
    return response.json<IntakeItem>();
  };

  it("records a pending draft without creating a canonical finding", async () => {
    const item = await createManual();

    expect(item.status).toBe("PENDING");
    expect(item.batch.source).toBe("MANUAL");
    expect(item.createdFindingId).toBeNull();

    const findings = await harness.app.inject({
      method: "GET",
      url: `/v1/findings?caseId=${researchCase.id}`,
      headers: owner.headers,
    });
    expect(findings.json<{ items: FindingDetail[] }>().items).toHaveLength(0);
  });

  it("creates one audited folder batch without accepting any proposal", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/intake/folder",
      headers: owner.headers,
      payload: {
        caseId: researchCase.id,
        sourceLabel: "historical-case",
        files: [
          {
            relativePath: "finding.md",
            sizeBytes: 42,
            sha256: "a".repeat(64),
            disposition: "MAPPED",
          },
        ],
        items: [
          {
            draft: {
              title: "Imported request smuggling finding",
              summaryMarkdown: "Conflicting message lengths split the request.",
              suggestedCweIds: ["CWE-444"],
              affectedVersions: [],
            },
            citations: [
              {
                kind: "FILE",
                path: "finding.md",
                sha256: "a".repeat(64),
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const result = response.json<{ batchId: string; items: IntakeItem[] }>();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      status: "PENDING",
      createdFindingId: null,
      batch: { id: result.batchId, source: "FOLDER_SCAN" },
    });
  });

  it("shows restricted-case intake to another cleared organization member", async () => {
    await createManual();

    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/intake?caseId=${researchCase.id}`,
      headers: outsider.headers,
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ items: IntakeItem[] }>().items.length,
    ).toBeGreaterThan(0);
  });

  it("accepts once and creates a finding only in safe initial states", async () => {
    const item = await createManual();
    const accepted = await harness.app.inject({
      method: "POST",
      url: `/v1/intake/items/${item.id}/accept`,
      headers: owner.headers,
      payload: { expectedRevision: item.revision },
    });

    expect(accepted.statusCode).toBe(200);
    const reviewed = accepted.json<IntakeItem>();
    expect(reviewed.status).toBe("ACCEPTED");
    expect(reviewed.createdFindingId).not.toBeNull();

    const findingResponse = await harness.app.inject({
      method: "GET",
      url: `/v1/findings/${reviewed.createdFindingId}`,
      headers: owner.headers,
    });
    const finding = findingResponse.json<FindingDetail>();
    expect(finding.validationState).toBe("DRAFT");
    expect(finding.disclosureState).toBe("PRIVATE");
    expect(finding.priorArtState).toBe("UNCHECKED");
    expect(finding.visibility).toBe("INTERNAL");
    expect(finding.cweIds).toEqual(["CWE-89"]);

    const second = await harness.app.inject({
      method: "POST",
      url: `/v1/intake/items/${item.id}/accept`,
      headers: owner.headers,
      payload: { expectedRevision: item.revision },
    });
    expect(second.statusCode).toBe(409);
  });

  it("rejects with a reason and never creates a finding", async () => {
    const item = await createManual();
    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/intake/items/${item.id}/reject`,
      headers: owner.headers,
      payload: { expectedRevision: item.revision, reason: "Duplicate notes" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<IntakeItem>()).toMatchObject({
      status: "REJECTED",
      rejectionReason: "Duplicate notes",
      createdFindingId: null,
    });
  });
});
