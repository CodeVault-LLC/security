import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import type {
  CaseDetail,
  FindingDetail,
  RemediationSla,
  RemediationSlaSettings,
} from "@codevault/contracts";
import { schema } from "@codevault/db";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("finding remediation SLA", () => {
  let harness: TestHarness;
  let user: TestUser;
  let finding: FindingDetail;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser();
    const researchCase = (
      await harness.app.inject({
        method: "POST",
        url: "/v1/cases",
        headers: user.headers,
        payload: { title: "SLA case", profile: "STANDARD" },
      })
    ).json<CaseDetail>();
    finding = (
      await harness.app.inject({
        method: "POST",
        url: "/v1/findings",
        headers: user.headers,
        payload: { caseId: researchCase.id, title: "SLA finding" },
      })
    ).json<FindingDetail>();
  });

  afterAll(async () => harness.close());

  it("tracks at-risk deadlines and resolves them with remediation state", async () => {
    const empty = await harness.app.inject({
      method: "GET",
      url: `/v1/findings/${finding.id}/remediation-sla`,
      headers: user.headers,
    });
    expect(empty.json<RemediationSlaSettings>().sla).toBeNull();

    const targetAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const created = await harness.app.inject({
      method: "PATCH",
      url: `/v1/findings/${finding.id}/remediation-sla`,
      headers: user.headers,
      payload: { targetAt, note: "Customer remediation target" },
    });
    expect(created.statusCode).toBe(200);
    const sla = created.json<RemediationSla>();
    expect(sla.status).toBe("AT_RISK");
    expect(sla.remainingDays).toBeGreaterThanOrEqual(2);

    await harness.dbHandle.db
      .update(schema.findings)
      .set({ remediationState: "FIX_VERIFIED" })
      .where(eq(schema.findings.id, finding.id));
    const resolved = await harness.app.inject({
      method: "GET",
      url: `/v1/findings/${finding.id}/remediation-sla`,
      headers: user.headers,
    });
    expect(resolved.json<RemediationSlaSettings>().sla?.status).toBe("MET");
  });

  it("requires the current revision when changing an existing deadline", async () => {
    const stale = await harness.app.inject({
      method: "PATCH",
      url: `/v1/findings/${finding.id}/remediation-sla`,
      headers: user.headers,
      payload: {
        targetAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
        expectedRevision: 99,
      },
    });
    expect(stale.statusCode).toBe(409);
  });
});
