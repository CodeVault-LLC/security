import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AssetDetail, CaseDetail } from "@codevault/contracts";
import { schema } from "@codevault/db";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("case template duplication", () => {
  let harness: TestHarness;
  let owner: TestUser;
  let collaborator: TestUser;
  let source: CaseDetail;
  let asset: AssetDetail;

  beforeAll(async () => {
    harness = await createHarness();
    owner = await harness.createUser({ role: "MEMBER" });
    collaborator = await harness.createUser({ role: "MEMBER" });

    source = (
      await harness.app.inject({
        method: "POST",
        url: "/v1/cases",
        headers: owner.headers,
        payload: {
          title: "Original coordinated research",
          summary: "Reusable research scope.",
          profile: "COORDINATED_DISCLOSURE",
          restricted: true,
        },
      })
    ).json<CaseDetail>();

    await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${source.id}/members`,
      headers: owner.headers,
      payload: {
        userId: collaborator.id,
        capabilities: ["READ", "WRITE", "APPROVAL", "DISCLOSURE"],
      },
    });

    asset = (
      await harness.app.inject({
        method: "POST",
        url: "/v1/assets",
        headers: owner.headers,
        payload: {
          caseId: source.id,
          name: "Shared target",
          kind: "SOFTWARE_COMPONENT",
        },
      })
    ).json<AssetDetail>();

    await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: owner.headers,
      payload: { caseId: source.id, title: "Do not duplicate this finding" },
    });
  });

  afterAll(async () => harness.close());

  it("copies case settings, policy, selected access, and asset links only", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${source.id}/duplicate`,
      headers: owner.headers,
      payload: {
        title: "Follow-up coordinated research",
        copyAssets: true,
        copyMembers: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const duplicate = response.json<CaseDetail>();
    expect(duplicate).toMatchObject({
      title: "Follow-up coordinated research",
      summary: source.summary,
      profile: source.profile,
      status: "OPEN",
      restricted: true,
      disclosureEnabled: true,
      findingCount: 0,
      owner: { id: owner.id },
      policyPackIds: source.policyPackIds,
    });
    expect(duplicate.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user: expect.objectContaining({ id: collaborator.id }),
          capabilities: ["READ", "WRITE", "APPROVAL", "DISCLOSURE"],
        }),
      ]),
    );

    const links = await harness.dbHandle.db
      .select()
      .from(schema.caseAssets)
      .where(
        and(
          eq(schema.caseAssets.caseId, duplicate.id),
          eq(schema.caseAssets.assetId, asset.id),
        ),
      );
    expect(links).toHaveLength(1);

    const findings = await harness.dbHandle.db
      .select({ id: schema.findings.id })
      .from(schema.findings)
      .where(eq(schema.findings.caseId, duplicate.id));
    expect(findings).toHaveLength(0);
  });

  it("does not grant duplication to a read-only member", async () => {
    await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${source.id}/members`,
      headers: owner.headers,
      payload: { userId: collaborator.id, capabilities: ["READ"] },
    });

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${source.id}/duplicate`,
      headers: collaborator.headers,
      payload: { title: "Forbidden duplicate" },
    });

    expect(response.statusCode).toBe(403);
  });
});
