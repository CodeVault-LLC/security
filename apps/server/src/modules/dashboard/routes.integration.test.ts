import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  CaseDetail,
  DashboardResponse,
  SubmissionDetail,
  VendorDetail,
  VendorRoute,
} from "@codevault/contracts";
import { uuidv7 } from "@codevault/core/crypto";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("submission coordination dashboard", () => {
  let harness: TestHarness;
  let owner: TestUser;
  let outsider: TestUser;
  let submission: SubmissionDetail;

  beforeAll(async () => {
    harness = await createHarness();
    owner = await harness.createUser({ role: "MEMBER" });
    outsider = await harness.createUser({ role: "MEMBER" });

    const caseResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: owner.headers,
      payload: {
        title: `Restricted coordination ${uuidv7()}`,
        profile: "COORDINATED_DISCLOSURE",
        restricted: true,
      },
    });
    expect(caseResponse.statusCode).toBe(200);
    const researchCase = caseResponse.json<CaseDetail>();

    const vendorResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/vendors",
      headers: owner.headers,
      payload: { name: `Dashboard vendor ${uuidv7()}` },
    });
    expect(vendorResponse.statusCode).toBe(200);
    const vendor = vendorResponse.json<VendorDetail>();

    const routeResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/routes`,
      headers: owner.headers,
      payload: {
        name: "Manual security intake",
        type: "MANUAL",
        destinationUrl: "https://security.example.test/report",
        fieldMappings: [
          {
            key: "summary",
            label: "Summary",
            required: true,
            format: "MULTILINE_TEXT",
            submissionField: "reproduction",
            helpText: null,
          },
        ],
        acceptedExtensions: [".pdf"],
        maximumFileBytes: 10_000_000,
        maximumFileCount: 3,
        acknowledgementBusinessDays: 5,
        updateCadenceDays: 30,
        instructions: null,
        sourceUrl: null,
        sourceReviewedAt: null,
      },
    });
    expect(routeResponse.statusCode).toBe(200);
    const route = routeResponse.json<VendorRoute>();

    const submissionResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${researchCase.id}/submissions`,
      headers: owner.headers,
      payload: { vendorId: vendor.id, routeId: route.id, cryptoMode: "PLAIN" },
    });
    expect(submissionResponse.statusCode).toBe(200);
    submission = submissionResponse.json<SubmissionDetail>();

    const lifecycleResponse = await harness.app.inject({
      method: "PATCH",
      url: `/v1/submissions/${submission.id}/lifecycle`,
      headers: owner.headers,
      payload: {
        coordinationState: "IN_TRIAGE",
        plannedNextContactAt: "2026-01-01T12:00:00.000Z",
        agreedDisclosureAt: null,
        vendorReference: "PSIRT-4242",
        coordinationNotes: "Waiting for the vendor's technical triage update.",
        snoozedUntil: null,
        snoozeReason: null,
        expectedRevision: submission.revision,
      },
    });
    expect(lifecycleResponse.statusCode, lifecycleResponse.body).toBe(200);
    submission = lifecycleResponse.json<SubmissionDetail>();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("surfaces the overdue next contact for an authorized researcher", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: owner.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    const dashboard = response.json<DashboardResponse>();
    expect(dashboard.needsAttention).toContainEqual(
      expect.objectContaining({
        entityType: "submission",
        entityId: submission.id,
        kind: "VENDOR_UPDATE_OVERDUE",
      }),
    );
  });

  it("does not leak restricted coordination work to another member", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: outsider.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    const dashboard = response.json<DashboardResponse>();
    expect(
      dashboard.needsAttention.some((item) => item.entityId === submission.id),
    ).toBe(false);
  });
});
