import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CaseDetail, FindingDetail } from "@codevault/contracts";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "./testing/harness.js";

/**
 * Authorization.
 *
 * Every account is cleared into the single organization, so every active
 * member can read the entire research corpus. Case membership still controls
 * explicit write grants and downgrades.
 */

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("case access", () => {
  let harness: TestHarness;
  let owner: TestUser;
  let outsider: TestUser;
  let admin: TestUser;
  let viewer: TestUser;
  let openCase: CaseDetail;
  let restrictedCase: CaseDetail;

  beforeAll(async () => {
    harness = await createHarness();
    owner = await harness.createUser({ role: "MEMBER" });
    outsider = await harness.createUser({ role: "MEMBER" });
    admin = await harness.createUser({ role: "ADMIN" });
    viewer = await harness.createUser({ role: "VIEWER" });

    const open = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: owner.headers,
      payload: { title: "Open case", profile: "STANDARD" },
    });

    openCase = open.json<CaseDetail>();

    const restricted = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: owner.headers,
      payload: {
        title: "Embargoed zero-day",
        profile: "CRITICAL_ZERO_DAY",
        restricted: true,
      },
    });

    restrictedCase = restricted.json<CaseDetail>();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("lets the owner read their restricted case", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${restrictedCase.id}`,
      headers: owner.headers,
    });

    expect(response.statusCode).toBe(200);
  });

  it("lets an organization member read a restricted case", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${restrictedCase.id}`,
      headers: outsider.headers,
    });

    expect(response.statusCode).toBe(200);
  });

  it("lets an administrator read a restricted case", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${restrictedCase.id}`,
      headers: admin.headers,
    });

    expect(response.statusCode).toBe(200);
  });

  it("includes restricted cases in every member's list", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/cases?limit=200",
      headers: outsider.headers,
    });

    const body = response.json<{ items: CaseDetail[] }>();
    const references = body.items.map((item) => item.id);

    expect(references).toContain(openCase.id);
    expect(references).toContain(restrictedCase.id);
  });

  it("grants access once a member is added", async () => {
    await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${restrictedCase.id}/members`,
      headers: owner.headers,
      payload: { userId: outsider.id, access: "READ" },
    });

    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${restrictedCase.id}`,
      headers: outsider.headers,
    });

    expect(response.statusCode).toBe(200);
  });

  it("keeps a read-only member from writing to the case", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: outsider.headers,
      payload: { caseId: restrictedCase.id, title: "Should not be created" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("refuses to let a viewer create anything", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: viewer.headers,
      payload: { caseId: openCase.id, title: "Viewer finding" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("refuses to let a viewer create a case", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: viewer.headers,
      payload: { title: "Viewer case", profile: "STANDARD" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("lets a viewer read an open case", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${openCase.id}`,
      headers: viewer.headers,
    });

    expect(response.statusCode).toBe(200);
  });

  it("shows restricted-case findings to organization members", async () => {
    const stranger = await harness.createUser({ role: "MEMBER" });

    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: owner.headers,
      payload: {
        caseId: restrictedCase.id,
        title: "Unauthenticated RCE in the update endpoint",
      },
    });

    const finding = created.json<FindingDetail>();

    const direct = await harness.app.inject({
      method: "GET",
      url: `/v1/findings/${finding.id}`,
      headers: stranger.headers,
    });

    expect(direct.statusCode).toBe(200);

    const list = await harness.app.inject({
      method: "GET",
      url: "/v1/findings?limit=200",
      headers: stranger.headers,
    });

    const ids = list
      .json<{ items: FindingDetail[] }>()
      .items.map((it) => it.id);

    expect(ids).toContain(finding.id);
  });

  it("includes a restricted case's findings in organization search", async () => {
    const stranger = await harness.createUser({ role: "MEMBER" });
    const marker = `ZeroDayMarker${Date.now()}`;

    await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: owner.headers,
      payload: { caseId: restrictedCase.id, title: `${marker} in firmware` },
    });

    const search = await harness.app.inject({
      method: "GET",
      url: `/v1/search?q=${marker}`,
      headers: stranger.headers,
    });

    const groups = search.json<{
      groups: Array<{ hits: Array<{ title: string }> }>;
    }>().groups;

    const titles = groups.flatMap((group) =>
      group.hits.map((hit) => hit.title),
    );

    expect(titles.join(" ")).toContain(marker);
  });

  it("refuses to let a non-owner member change membership", async () => {
    const other = await harness.createUser({ role: "MEMBER" });

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${openCase.id}/members`,
      headers: other.headers,
      payload: { userId: other.id, access: "WRITE" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("refuses to remove the case owner from their own case", async () => {
    const response = await harness.app.inject({
      method: "DELETE",
      url: `/v1/cases/${openCase.id}/members/${owner.id}`,
      headers: owner.headers,
    });

    expect(response.statusCode).toBe(400);
  });
});

describeIntegration("optimistic concurrency", () => {
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
      payload: { title: "Concurrency", profile: "STANDARD" },
    });

    const researchCase = created.json<CaseDetail>();

    const createdFinding = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: user.headers,
      payload: { caseId: researchCase.id, title: "Concurrent edits" },
    });

    finding = createdFinding.json<FindingDetail>();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("rejects an update written against a stale revision", async () => {
    const first = await harness.app.inject({
      method: "PATCH",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
      payload: {
        summaryMarkdown: "First edit",
        expectedRevision: finding.revision,
      },
    });

    expect(first.statusCode).toBe(200);

    const stale = await harness.app.inject({
      method: "PATCH",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
      payload: {
        summaryMarkdown: "Second edit against the old revision",
        expectedRevision: finding.revision,
      },
    });

    expect(stale.statusCode).toBe(409);
    expect(
      stale.json<{ error: { message: string } }>().error.message,
    ).toContain("changed since you loaded it");
  });
});

describeIntegration("finding lifecycle", () => {
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
      payload: { title: "Lifecycle", profile: "STANDARD" },
    });

    const createdFinding = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: user.headers,
      payload: {
        caseId: created.json<CaseDetail>().id,
        title: "Lifecycle finding",
      },
    });

    finding = createdFinding.json<FindingDetail>();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("refuses to confirm a finding that was never reproduced", async () => {
    const response = await harness.app.inject({
      method: "PATCH",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
      payload: {
        validationState: "CONFIRMED",
        expectedRevision: finding.revision,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses to skip from private straight to embargoed", async () => {
    const response = await harness.app.inject({
      method: "PATCH",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
      payload: {
        disclosureState: "EMBARGOED",
        expectedRevision: finding.revision,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("computes the score from the vector and refuses a supplied one", async () => {
    const supplied = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/scores`,
      headers: user.headers,
      payload: {
        scheme: "CVSS40",
        vector:
          "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N",
        score: 1.0,
      },
    });

    expect(supplied.statusCode).toBe(400);

    const computed = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/scores`,
      headers: user.headers,
      payload: {
        scheme: "CVSS40",
        vector:
          "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N",
        approve: true,
      },
    });

    const body = computed.json<FindingDetail>();

    expect(body.score).toBe(9.3);
    expect(body.severity).toBe("CRITICAL");
  });

  it("rejects an invalid CVSS vector", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/scores`,
      headers: user.headers,
      payload: { scheme: "CVSS40", vector: "CVSS:4.0/AV:Q" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects an invalid CWE identifier", async () => {
    const current = await harness.app.inject({
      method: "GET",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
    });

    const response = await harness.app.inject({
      method: "PATCH",
      url: `/v1/findings/${finding.id}`,
      headers: user.headers,
      payload: {
        cweIds: ["SQL injection"],
        expectedRevision: current.json<FindingDetail>().revision,
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
