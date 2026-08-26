import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  CaseDetail,
  FindingDetail,
  IntelligenceRefreshPolicy,
} from "@codevault/contracts";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("intelligence refresh controls", () => {
  let harness: TestHarness;
  let user: TestUser;
  let finding: FindingDetail;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser();
    const createdCase = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: { title: "Intelligence scheduling case", profile: "STANDARD" },
    });
    const researchCase = createdCase.json<CaseDetail>();
    const createdFinding = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: user.headers,
      payload: {
        caseId: researchCase.id,
        title: "Externally tracked vulnerability",
      },
    });
    finding = createdFinding.json<FindingDetail>();
  });

  afterAll(async () => harness.close());

  it("requires a CVE before enabling a schedule", async () => {
    const response = await harness.app.inject({
      method: "PATCH",
      url: `/v1/findings/${finding.id}/intelligence-refresh`,
      headers: user.headers,
      payload: { cadence: "DAILY", enabled: true },
    });
    expect(response.statusCode).toBe(400);
  });

  it("schedules, runs now, and pauses refreshes", async () => {
    const identifier = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/identifiers`,
      headers: user.headers,
      payload: { scheme: "CVE", value: "CVE-2026-12345" },
    });
    expect(identifier.statusCode, identifier.body).toBe(200);

    const enabled = await harness.app.inject({
      method: "PATCH",
      url: `/v1/findings/${finding.id}/intelligence-refresh`,
      headers: user.headers,
      payload: { cadence: "DAILY", enabled: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    const policy = enabled.json<IntelligenceRefreshPolicy>();
    expect(policy).toMatchObject({
      findingId: finding.id,
      cadence: "DAILY",
      enabled: true,
      revision: 1,
    });
    expect(policy.nextRunAt).not.toBeNull();
    const schedule = harness.jobs.schedules.get(
      `intelligence-refresh:finding-intelligence-${finding.id}`,
    );
    expect(schedule).toMatchObject({
      cron: "0 3 * * *",
      data: {
        findingId: finding.id,
        cveIds: ["CVE-2026-12345"],
        scheduled: true,
      },
    });

    const run = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/intelligence-refresh/run`,
      headers: user.headers,
    });
    expect(run.statusCode, run.body).toBe(200);
    expect(harness.jobs.sent.at(-1)?.data).toEqual({
      findingId: finding.id,
      cveIds: ["CVE-2026-12345"],
    });

    const paused = await harness.app.inject({
      method: "PATCH",
      url: `/v1/findings/${finding.id}/intelligence-refresh`,
      headers: user.headers,
      payload: {
        cadence: "DAILY",
        enabled: false,
        expectedRevision: policy.revision,
      },
    });
    expect(paused.statusCode, paused.body).toBe(200);
    expect(paused.json<IntelligenceRefreshPolicy>()).toMatchObject({
      enabled: false,
      nextRunAt: null,
      revision: 2,
    });
    expect(
      harness.jobs.schedules.has(
        `intelligence-refresh:finding-intelligence-${finding.id}`,
      ),
    ).toBe(false);
  });

  it("returns the stored policy to readers", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/findings/${finding.id}/intelligence-refresh`,
      headers: user.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().policy).toMatchObject({
      findingId: finding.id,
      enabled: false,
    });
  });
});
