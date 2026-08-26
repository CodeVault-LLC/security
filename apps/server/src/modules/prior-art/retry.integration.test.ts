import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  CaseDetail,
  FindingDetail,
  PriorArtCheck,
} from "@codevault/contracts";
import { schema } from "@codevault/db";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("prior-art retries", () => {
  let harness: TestHarness;
  let user: TestUser;
  let finding: FindingDetail;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser();
    const caseResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: { title: "Prior art retry case", profile: "STANDARD" },
    });
    const researchCase = caseResponse.json<CaseDetail>();
    const findingResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: user.headers,
      payload: {
        caseId: researchCase.id,
        title: "Retryable traversal finding",
      },
    });
    finding = findingResponse.json<FindingDetail>();
  });

  afterAll(async () => harness.close());

  it("retries a failed run with its exact stored options", async () => {
    const started = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/prior-art-checks`,
      headers: user.headers,
      payload: {
        keywords: ["archive boundary", "path normalization"],
        skipAiSynthesis: true,
      },
    });
    expect(started.statusCode, started.body).toBe(200);
    const failed = started.json<PriorArtCheck>();
    expect(failed.requestOptions).toEqual({
      keywords: ["archive boundary", "path normalization"],
      skipAiSynthesis: true,
    });

    await harness.dbHandle.db
      .update(schema.priorArtChecks)
      .set({ status: "FAILED", failureReason: "Provider timed out" })
      .where(eq(schema.priorArtChecks.id, failed.id));

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/prior-art-checks/${failed.id}/retry`,
      headers: user.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    const retry = response.json<PriorArtCheck>();
    expect(retry).toMatchObject({
      findingId: finding.id,
      status: "QUEUED",
      retryOfCheckId: failed.id,
      requestOptions: failed.requestOptions,
      failureReason: null,
    });
    expect(harness.jobs.sent.at(-1)?.data).toMatchObject({
      checkId: retry.id,
      findingId: finding.id,
      keywords: failed.requestOptions.keywords,
      skipAiSynthesis: true,
    });
  });

  it("rejects retrying a clean completed run", async () => {
    const started = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/prior-art-checks`,
      headers: user.headers,
      payload: {},
    });
    const clean = started.json<PriorArtCheck>();
    await harness.dbHandle.db
      .update(schema.priorArtChecks)
      .set({ status: "COMPLETED", sourcesChecked: [] })
      .where(eq(schema.priorArtChecks.id, clean.id));

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/prior-art-checks/${clean.id}/retry`,
      headers: user.headers,
    });
    expect(response.statusCode).toBe(400);
  });
});
