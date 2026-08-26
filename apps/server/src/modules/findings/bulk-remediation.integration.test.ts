import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CaseDetail, FindingDetail } from "@codevault/contracts";
import { schema } from "@codevault/db";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("bulk finding remediation", () => {
  let harness: TestHarness;
  let owner: TestUser;
  let caseDetail: CaseDetail;
  let findings: FindingDetail[];

  beforeAll(async () => {
    harness = await createHarness();
    owner = await harness.createUser({ role: "MEMBER" });
    const caseResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: owner.headers,
      payload: {
        title: "Coordinated remediation",
        profile: "STANDARD",
      },
    });
    expect(caseResponse.statusCode, caseResponse.body).toBe(200);
    caseDetail = caseResponse.json<CaseDetail>();
    findings = await Promise.all(
      ["Parser bypass", "Authorization bypass"].map(async (title) => {
        const response = await harness.app.inject({
          method: "POST",
          url: "/v1/findings",
          headers: owner.headers,
          payload: { caseId: caseDetail.id, title },
        });
        expect(response.statusCode, response.body).toBe(200);
        return response.json<FindingDetail>();
      }),
    );
  });

  afterAll(async () => harness.close());

  it("updates selected findings atomically and audits each transition", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/findings/actions/bulk-remediation",
      headers: owner.headers,
      payload: {
        caseId: caseDetail.id,
        remediationState: "FIXED",
        items: findings.map((finding) => ({
          id: finding.id,
          expectedRevision: finding.revision,
        })),
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      updatedIds: findings.map((finding) => finding.id),
    });

    const updated = await harness.dbHandle.db
      .select({
        id: schema.findings.id,
        remediationState: schema.findings.remediationState,
        revision: schema.findings.revision,
      })
      .from(schema.findings)
      .where(
        inArray(
          schema.findings.id,
          findings.map((finding) => finding.id),
        ),
      );
    expect(updated).toHaveLength(2);
    expect(
      updated.every((finding) => finding.remediationState === "FIXED"),
    ).toBe(true);
    expect(updated.every((finding) => finding.revision === 2)).toBe(true);

    const audit = await harness.dbHandle.db
      .select({
        entityId: schema.auditEvents.entityId,
        action: schema.auditEvents.action,
        before: schema.auditEvents.before,
        after: schema.auditEvents.after,
      })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, "finding.state_changed"),
          inArray(
            schema.auditEvents.entityId,
            findings.map((finding) => finding.id),
          ),
        ),
      );
    expect(audit).toHaveLength(2);
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          before: { remediationState: "UNKNOWN" },
          after: { remediationState: "FIXED" },
        }),
      ]),
    );
  });

  it("rejects the whole batch when any revision is stale", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/findings/actions/bulk-remediation",
      headers: owner.headers,
      payload: {
        caseId: caseDetail.id,
        remediationState: "REGRESSED",
        items: [
          { id: findings[0]!.id, expectedRevision: 2 },
          { id: findings[1]!.id, expectedRevision: 1 },
        ],
      },
    });

    expect(response.statusCode, response.body).toBe(409);
    const unchanged = await harness.dbHandle.db
      .select({ remediationState: schema.findings.remediationState })
      .from(schema.findings)
      .where(
        inArray(
          schema.findings.id,
          findings.map((finding) => finding.id),
        ),
      );
    expect(
      unchanged.every((finding) => finding.remediationState === "FIXED"),
    ).toBe(true);
  });
});
