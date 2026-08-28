import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CaseDetail, ScannerSyncProfile } from "@codevault/contracts";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("scanner synchronization profiles", () => {
  let harness: TestHarness;
  let owner: TestUser;
  let outsider: TestUser;
  let researchCase: CaseDetail;

  beforeAll(async () => {
    harness = await createHarness();
    owner = await harness.createUser();
    outsider = await harness.createUser();
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: owner.headers,
      payload: {
        title: "Restricted scanner synchronization",
        profile: "STANDARD",
        restricted: true,
      },
    });
    researchCase = created.json<CaseDetail>();
  });

  afterAll(async () => harness.close());

  it("creates and lists a reusable case-scoped profile", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/intake/scanner-profiles",
      headers: owner.headers,
      payload: {
        caseId: researchCase.id,
        name: "Nightly Semgrep",
        format: "SARIF",
        sourceLabel: "Semgrep CI",
        deduplicationPolicy: "SKIP_MATCHING_TITLES",
        cadenceHours: 24,
      },
    });

    expect(created.statusCode, created.body).toBe(200);
    const profile = created.json<ScannerSyncProfile>();
    expect(profile).toMatchObject({
      caseId: researchCase.id,
      name: "Nightly Semgrep",
      format: "SARIF",
      cadenceHours: 24,
      enabled: true,
      revision: 1,
      lastRunAt: null,
    });
    expect(Date.parse(profile.nextRunAt)).toBeGreaterThan(Date.now());

    const list = await harness.app.inject({
      method: "GET",
      url: `/v1/intake/scanner-profiles?caseId=${researchCase.id}`,
      headers: owner.headers,
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json<{ items: ScannerSyncProfile[] }>().items).toEqual([
      profile,
    ]);
  });

  it("updates cadence and rejects stale revisions", async () => {
    const list = await harness.app.inject({
      method: "GET",
      url: `/v1/intake/scanner-profiles?caseId=${researchCase.id}`,
      headers: owner.headers,
    });
    const current = list.json<{ items: ScannerSyncProfile[] }>().items[0]!;
    const updated = await harness.app.inject({
      method: "PATCH",
      url: `/v1/intake/scanner-profiles/${current.id}`,
      headers: owner.headers,
      payload: { expectedRevision: current.revision, cadenceHours: 168 },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json<ScannerSyncProfile>()).toMatchObject({
      cadenceHours: 168,
      revision: current.revision + 1,
    });

    const stale = await harness.app.inject({
      method: "PATCH",
      url: `/v1/intake/scanner-profiles/${current.id}`,
      headers: owner.headers,
      payload: { expectedRevision: current.revision, enabled: false },
    });
    expect(stale.statusCode).toBe(409);
  });

  it("hides profiles from an ungranted organization member", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/intake/scanner-profiles?caseId=${researchCase.id}`,
      headers: outsider.headers,
    });
    expect(response.statusCode, response.body).toBe(404);
  });
});
