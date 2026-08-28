import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  CaseDetail,
  CaseListResponse,
  FindingDetail,
  ServerEvent,
} from "@codevault/contracts";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "./testing/harness.js";

/**
 * Authorization.
 *
 * Every case requires an explicit read grant. A caller without one receives
 * the same response as for a missing object and sees no derived list data.
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

  it("hides an ungranted case from an organization member", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${restrictedCase.id}`,
      headers: outsider.headers,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { message: string } }>().error.message).toBe(
      "The requested resource was not found.",
    );
  });

  it("hides an ungranted case from an organization administrator", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${restrictedCase.id}`,
      headers: admin.headers,
    });

    expect(response.statusCode).toBe(404);
  });

  it("excludes every ungranted case from collection results", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/cases?limit=200",
      headers: outsider.headers,
    });

    const body = response.json<{ items: CaseDetail[] }>();
    const references = body.items.map((item) => item.id);

    expect(references).not.toContain(openCase.id);
    expect(references).not.toContain(restrictedCase.id);
  });

  it("returns an exact total and supports direct case-page requests", async () => {
    const firstPage = await harness.app.inject({
      method: "GET",
      url: `/v1/cases?limit=1&page=1&ownerId=${owner.id}`,
      headers: owner.headers,
    });
    const secondPage = await harness.app.inject({
      method: "GET",
      url: `/v1/cases?limit=1&page=2&ownerId=${owner.id}`,
      headers: owner.headers,
    });

    expect(firstPage.statusCode, firstPage.body).toBe(200);
    expect(secondPage.statusCode, secondPage.body).toBe(200);
    const first = firstPage.json<CaseListResponse>();
    const second = secondPage.json<CaseListResponse>();

    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
  });

  it("grants access once a member is added", async () => {
    await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${restrictedCase.id}/members`,
      headers: owner.headers,
      payload: { userId: outsider.id, capabilities: ["READ"] },
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

  it("enforces write, approval, and disclosure as independent capabilities", async () => {
    const writer = await harness.createUser({ role: "MEMBER" });
    const approver = await harness.createUser({ role: "MEMBER" });
    const discloser = await harness.createUser({ role: "MEMBER" });

    for (const grant of [
      { userId: writer.id, capabilities: ["READ", "WRITE"] },
      { userId: approver.id, capabilities: ["READ", "APPROVAL"] },
      { userId: discloser.id, capabilities: ["READ", "DISCLOSURE"] },
    ]) {
      const response = await harness.app.inject({
        method: "POST",
        url: `/v1/cases/${restrictedCase.id}/members`,
        headers: owner.headers,
        payload: grant,
      });

      expect(response.statusCode, response.body).toBe(200);
    }

    const findingResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: writer.headers,
      payload: {
        caseId: restrictedCase.id,
        title: "Capability boundary finding",
      },
    });
    expect(findingResponse.statusCode, findingResponse.body).toBe(200);
    const finding = findingResponse.json<FindingDetail>();

    const scoreResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/scores`,
      headers: writer.headers,
      payload: {
        scheme: "CVSS40",
        vector:
          "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N",
      },
    });
    expect(scoreResponse.statusCode, scoreResponse.body).toBe(200);
    const scoreId = scoreResponse.json<FindingDetail>().scores.at(-1)?.id;
    expect(scoreId).toBeDefined();

    const writerApproval = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/scores/${scoreId}/approve`,
      headers: writer.headers,
    });
    expect(writerApproval.statusCode).toBe(403);

    const approval = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/scores/${scoreId}/approve`,
      headers: approver.headers,
    });
    expect(approval.statusCode, approval.body).toBe(200);

    const writerDisclosure = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${restrictedCase.id}/embargo`,
      headers: writer.headers,
      payload: { plannedDisclosureAt: "2026-09-30T12:00:00.000Z" },
    });
    expect(writerDisclosure.statusCode).toBe(403);

    const disclosure = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${restrictedCase.id}/embargo`,
      headers: discloser.headers,
      payload: { plannedDisclosureAt: "2026-09-30T12:00:00.000Z" },
    });
    expect(disclosure.statusCode, disclosure.body).toBe(200);

    const discloserWrite = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: discloser.headers,
      payload: {
        caseId: restrictedCase.id,
        title: "Must not be created",
      },
    });
    expect(discloserWrite.statusCode).toBe(403);
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

  it("hides an ungranted open case from a viewer", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${openCase.id}`,
      headers: viewer.headers,
    });

    expect(response.statusCode).toBe(404);
  });

  it("hides restricted-case findings from ungranted organization members", async () => {
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

    expect(direct.statusCode).toBe(404);
    expect(direct.json<{ error: { message: string } }>().error.message).toBe(
      "The requested resource was not found.",
    );

    const missing = await harness.app.inject({
      method: "GET",
      url: "/v1/findings/018f47d2-7d20-7a31-8fb8-9d5f3d68ffff",
      headers: stranger.headers,
    });

    expect(missing.statusCode).toBe(404);
    const directError = direct.json<{
      error: { category: string; message: string };
    }>().error;
    const missingError = missing.json<{
      error: { category: string; message: string };
    }>().error;
    expect(missingError.category).toBe(directError.category);
    expect(missingError.message).toBe(directError.message);

    const list = await harness.app.inject({
      method: "GET",
      url: "/v1/findings?limit=200",
      headers: stranger.headers,
    });

    const ids = list
      .json<{ items: FindingDetail[] }>()
      .items.map((it) => it.id);

    expect(ids).not.toContain(finding.id);
  });

  it("excludes a restricted case's findings from ungranted search", async () => {
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

    expect(titles.join(" ")).not.toContain(marker);
  });

  it("refuses to let a non-owner member change membership", async () => {
    const other = await harness.createUser({ role: "MEMBER" });

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${openCase.id}/members`,
      headers: other.headers,
      payload: { userId: other.id, capabilities: ["READ", "WRITE"] },
    });

    expect(response.statusCode).toBe(404);
  });

  it("refuses to remove the case owner from their own case", async () => {
    const response = await harness.app.inject({
      method: "DELETE",
      url: `/v1/cases/${openCase.id}/members/${owner.id}`,
      headers: owner.headers,
    });

    expect(response.statusCode).toBe(400);
  });

  it("does not reveal a case through a no-op revocation event", async () => {
    const neverGranted = await harness.createUser({ role: "MEMBER" });
    const received: ServerEvent[] = [];
    const unsubscribe = harness.app.events.subscribe({
      id: `test-${neverGranted.id}`,
      userId: neverGranted.id,
      send: (event) => received.push(event),
    });

    try {
      const response = await harness.app.inject({
        method: "DELETE",
        url: `/v1/cases/${restrictedCase.id}/members/${neverGranted.id}`,
        headers: owner.headers,
      });

      expect(response.statusCode).toBe(200);
      expect(received).toHaveLength(0);
    } finally {
      unsubscribe();
    }
  });

  it("keeps a viewer owner from changing case membership", async () => {
    const viewerOwner = await harness.createUser({ role: "VIEWER" });
    const target = await harness.createUser({ role: "MEMBER" });
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: admin.headers,
      payload: {
        title: "Viewer-owned case",
        profile: "STANDARD",
        ownerId: viewerOwner.id,
      },
    });
    const viewerCase = created.json<CaseDetail>();

    const grant = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${viewerCase.id}/members`,
      headers: viewerOwner.headers,
      payload: { userId: target.id, capabilities: ["READ", "WRITE"] },
    });
    const revoke = await harness.app.inject({
      method: "DELETE",
      url: `/v1/cases/${viewerCase.id}/members/${target.id}`,
      headers: viewerOwner.headers,
    });

    expect(grant.statusCode).toBe(403);
    expect(revoke.statusCode).toBe(403);
  });

  it("evicts the former owner and grants the new owner on reassignment", async () => {
    const nextOwner = await harness.createUser({ role: "MEMBER" });
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: owner.headers,
      payload: { title: "Transferred case", profile: "STANDARD" },
    });
    const transferCase = created.json<CaseDetail>();
    const formerOwnerEvents: ServerEvent[] = [];
    const nextOwnerEvents: ServerEvent[] = [];
    const unsubscribeFormer = harness.app.events.subscribe({
      id: `former-owner-${transferCase.id}`,
      userId: owner.id,
      send: (event) => formerOwnerEvents.push(event),
    });
    const unsubscribeNext = harness.app.events.subscribe({
      id: `next-owner-${transferCase.id}`,
      userId: nextOwner.id,
      send: (event) => nextOwnerEvents.push(event),
    });

    try {
      const transferred = await harness.app.inject({
        method: "PATCH",
        url: `/v1/cases/${transferCase.id}`,
        headers: owner.headers,
        payload: {
          ownerId: nextOwner.id,
          expectedRevision: transferCase.revision,
        },
      });
      expect(transferred.statusCode, transferred.body).toBe(200);

      await vi.waitFor(() => {
        expect(formerOwnerEvents).toContainEqual(
          expect.objectContaining({
            type: "case.access_changed",
            caseId: transferCase.id,
            detail: expect.objectContaining({ canRead: false }),
          }),
        );
        expect(nextOwnerEvents).toContainEqual(
          expect.objectContaining({
            type: "case.access_changed",
            caseId: transferCase.id,
            detail: expect.objectContaining({ canRead: true }),
          }),
        );
      });

      const formerRead = await harness.app.inject({
        method: "GET",
        url: `/v1/cases/${transferCase.id}`,
        headers: owner.headers,
      });
      const nextRead = await harness.app.inject({
        method: "GET",
        url: `/v1/cases/${transferCase.id}`,
        headers: nextOwner.headers,
      });
      expect(formerRead.statusCode).toBe(404);
      expect(nextRead.statusCode).toBe(200);
    } finally {
      unsubscribeFormer();
      unsubscribeNext();
    }
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

  it("refuses to approve a score through a different finding", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: user.headers,
      payload: {
        caseId: finding.caseId,
        title: "A separate finding with its own score",
      },
    });
    const otherFinding = created.json<FindingDetail>();
    const scored = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${otherFinding.id}/scores`,
      headers: user.headers,
      payload: {
        scheme: "CVSS40",
        vector:
          "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N",
      },
    });
    const scoreId = scored.json<FindingDetail>().scores.at(-1)?.id;

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/findings/${finding.id}/scores/${scoreId}/approve`,
      headers: user.headers,
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
