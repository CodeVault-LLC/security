import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  CaseAccessHistoryResponse,
  CaseAccessReviewResponse,
  CaseDetail,
  ServerEvent,
} from "@codevault/contracts";
import { schema } from "@codevault/db";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("case access review", () => {
  let harness: TestHarness;
  let owner: TestUser;
  let viewer: TestUser;
  let hiddenOwner: TestUser;
  let researchCase: CaseDetail;
  let hiddenCase: CaseDetail;

  beforeAll(async () => {
    harness = await createHarness();
    owner = await harness.createUser({ role: "MEMBER" });
    viewer = await harness.createUser({ role: "VIEWER" });
    hiddenOwner = await harness.createUser({ role: "MEMBER" });

    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: owner.headers,
      payload: {
        title: "Access review case",
        profile: "COORDINATED_DISCLOSURE",
        restricted: true,
      },
    });
    researchCase = created.json<CaseDetail>();

    const hidden = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: hiddenOwner.headers,
      payload: {
        title: "Hidden access review case",
        profile: "STANDARD",
      },
    });
    hiddenCase = hidden.json<CaseDetail>();

    const granted = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${researchCase.id}/members`,
      headers: owner.headers,
      payload: {
        userId: viewer.id,
        capabilities: ["READ", "WRITE", "APPROVAL", "DISCLOSURE"],
      },
    });
    expect(granted.statusCode, granted.body).toBe(200);
  });

  afterAll(async () => {
    await harness.close();
  });

  it("lists effective authority for readable cases without exposing hidden cases", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/cases/access-review?limit=200",
      headers: viewer.headers,
    });

    expect(response.statusCode, response.body).toBe(200);
    const review = response.json<CaseAccessReviewResponse>();
    expect(review.items.map((item) => item.id)).toContain(researchCase.id);
    expect(review.items.map((item) => item.id)).not.toContain(hiddenCase.id);

    const item = review.items.find(
      (candidate) => candidate.id === researchCase.id,
    );
    expect(item?.principals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user: expect.objectContaining({ id: owner.id }),
          source: "OWNER",
          grantedCapabilities: ["READ", "WRITE", "APPROVAL", "DISCLOSURE"],
          effectiveCapabilities: ["READ", "WRITE", "APPROVAL", "DISCLOSURE"],
        }),
        expect.objectContaining({
          user: expect.objectContaining({ id: viewer.id }),
          role: "VIEWER",
          source: "GRANT",
          grantedCapabilities: ["READ", "WRITE", "APPROVAL", "DISCLOSURE"],
          effectiveCapabilities: ["READ"],
        }),
      ]),
    );

    const personSearch = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/access-review?limit=200&query=${encodeURIComponent(viewer.email)}`,
      headers: viewer.headers,
    });
    expect(personSearch.statusCode, personSearch.body).toBe(200);
    expect(
      personSearch.json<CaseAccessReviewResponse>().items.map((row) => row.id),
    ).toContain(researchCase.id);
  });

  it("records grants, changes, and revocations with exact capability snapshots", async () => {
    const member = await harness.createUser({ role: "MEMBER" });

    const grant = async (capabilities: string[]) =>
      harness.app.inject({
        method: "POST",
        url: `/v1/cases/${researchCase.id}/members`,
        headers: owner.headers,
        payload: { userId: member.id, capabilities },
      });

    expect((await grant(["READ", "WRITE"])).statusCode).toBe(200);
    expect((await grant(["READ", "APPROVAL"])).statusCode).toBe(200);
    expect((await grant(["READ", "APPROVAL"])).statusCode).toBe(200);

    const revoke = await harness.app.inject({
      method: "DELETE",
      url: `/v1/cases/${researchCase.id}/members/${member.id}`,
      headers: owner.headers,
    });
    expect(revoke.statusCode, revoke.body).toBe(200);

    const historyResponse = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${researchCase.id}/access-history?limit=50`,
      headers: owner.headers,
    });
    expect(historyResponse.statusCode, historyResponse.body).toBe(200);

    const memberEvents = historyResponse
      .json<CaseAccessHistoryResponse>()
      .items.filter((event) => event.subject?.id === member.id);
    expect(memberEvents).toHaveLength(3);
    expect(memberEvents.map((event) => event.kind)).toEqual([
      "REVOKED",
      "UPDATED",
      "GRANTED",
    ]);
    expect(memberEvents[0]).toMatchObject({
      beforeCapabilities: ["READ", "APPROVAL"],
      afterCapabilities: [],
    });
    expect(memberEvents[1]).toMatchObject({
      beforeCapabilities: ["READ", "WRITE"],
      afterCapabilities: ["READ", "APPROVAL"],
    });
    expect(memberEvents[2]).toMatchObject({
      beforeCapabilities: [],
      afterCapabilities: ["READ", "WRITE"],
    });

    const hiddenHistory = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${researchCase.id}/access-history?limit=50`,
      headers: member.headers,
    });
    expect(hiddenHistory.statusCode).toBe(404);
  });

  it("labels pre-review audit records without a before snapshot as legacy", async () => {
    const legacyMember = await harness.createUser({ role: "MEMBER" });
    await harness.dbHandle.db.insert(schema.auditEvents).values({
      organizationId: harness.organizationId,
      action: "case.member_added",
      entityType: "case",
      entityId: researchCase.id,
      caseId: researchCase.id,
      actorId: owner.id,
      before: null,
      after: {
        userId: legacyMember.id,
        capabilities: ["READ", "WRITE"],
      },
    });

    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${researchCase.id}/access-history?limit=100`,
      headers: owner.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response
        .json<CaseAccessHistoryResponse>()
        .items.find((event) => event.subject?.id === legacyMember.id),
    ).toMatchObject({
      kind: "LEGACY_CHANGE",
      beforeCapabilities: null,
      afterCapabilities: ["READ", "WRITE"],
    });
  });

  it("serializes concurrent grants into one truthful history entry", async () => {
    const member = await harness.createUser({ role: "MEMBER" });
    const responses = await Promise.all(
      [1, 2].map(() =>
        harness.app.inject({
          method: "POST",
          url: `/v1/cases/${researchCase.id}/members`,
          headers: owner.headers,
          payload: {
            userId: member.id,
            capabilities: ["READ", "DISCLOSURE"],
          },
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200,
    ]);

    const historyResponse = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${researchCase.id}/access-history?limit=50`,
      headers: owner.headers,
    });
    const events = historyResponse
      .json<CaseAccessHistoryResponse>()
      .items.filter((event) => event.subject?.id === member.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "GRANTED",
      beforeCapabilities: [],
      afterCapabilities: ["READ", "DISCLOSURE"],
    });
  });

  it("records ownership transfers with both owners", async () => {
    const nextOwner = await harness.createUser({ role: "MEMBER" });
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: owner.headers,
      payload: { title: "Ownership review case", profile: "STANDARD" },
    });
    const transferCase = created.json<CaseDetail>();

    const granted = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${transferCase.id}/members`,
      headers: owner.headers,
      payload: { userId: nextOwner.id, capabilities: ["READ", "APPROVAL"] },
    });
    expect(granted.statusCode, granted.body).toBe(200);

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

    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${transferCase.id}/access-history?limit=20`,
      headers: nextOwner.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<CaseAccessHistoryResponse>().items).toContainEqual(
      expect.objectContaining({
        kind: "OWNER_TRANSFERRED",
        subject: expect.objectContaining({ id: nextOwner.id }),
        previousSubject: expect.objectContaining({ id: owner.id }),
      }),
    );

    const reviewResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/cases/access-review?limit=200&query=Ownership%20review%20case",
      headers: nextOwner.headers,
    });
    expect(reviewResponse.statusCode, reviewResponse.body).toBe(200);
    const principals = reviewResponse
      .json<CaseAccessReviewResponse>()
      .items.find((item) => item.id === transferCase.id)
      ?.principals.filter((candidate) => candidate.user.id === nextOwner.id);
    expect(principals).toEqual([
      expect.objectContaining({
        source: "OWNER",
        user: expect.objectContaining({ id: nextOwner.id }),
      }),
    ]);
  });

  it("commits only one of two same-revision ownership transfers", async () => {
    const administrator = await harness.createUser({ role: "ADMIN" });
    const firstCandidate = await harness.createUser({ role: "MEMBER" });
    const secondCandidate = await harness.createUser({ role: "MEMBER" });
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: owner.headers,
      payload: { title: "Concurrent owner case", profile: "STANDARD" },
    });
    const transferCase = created.json<CaseDetail>();
    const administratorGrant = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${transferCase.id}/members`,
      headers: owner.headers,
      payload: { userId: administrator.id, capabilities: ["READ", "WRITE"] },
    });
    expect(administratorGrant.statusCode, administratorGrant.body).toBe(200);
    const formerOwnerEvents: ServerEvent[] = [];
    const candidateEvents = new Map<string, ServerEvent[]>([
      [firstCandidate.id, []],
      [secondCandidate.id, []],
    ]);
    const unsubscribes = [
      harness.app.events.subscribe({
        id: `concurrent-former-${transferCase.id}`,
        userId: owner.id,
        send: (event) => formerOwnerEvents.push(event),
      }),
      ...[firstCandidate, secondCandidate].map((candidate) =>
        harness.app.events.subscribe({
          id: `concurrent-candidate-${candidate.id}`,
          userId: candidate.id,
          send: (event) => candidateEvents.get(candidate.id)?.push(event),
        }),
      ),
    ];

    try {
      const responses = await Promise.all(
        [firstCandidate, secondCandidate].map((candidate) =>
          harness.app.inject({
            method: "PATCH",
            url: `/v1/cases/${transferCase.id}`,
            headers: administrator.headers,
            payload: {
              ownerId: candidate.id,
              expectedRevision: transferCase.revision,
            },
          }),
        ),
      );
      expect(responses.map((response) => response.statusCode).sort()).toEqual([
        200, 409,
      ]);

      const winnerResponse = responses.find(
        (response) => response.statusCode === 200,
      );
      expect(winnerResponse).toBeDefined();
      const winner = winnerResponse!.json<CaseDetail>().owner.id;
      const loser = [firstCandidate.id, secondCandidate.id].find(
        (id) => id !== winner,
      )!;

      await vi.waitFor(() => {
        expect(
          formerOwnerEvents.filter(
            (event) =>
              event.type === "case.access_changed" &&
              event.detail["canRead"] === false,
          ),
        ).toHaveLength(1);
        expect(
          candidateEvents
            .get(winner)
            ?.filter((event) => event.type === "case.access_changed"),
        ).toHaveLength(1);
      });
      expect(
        candidateEvents
          .get(loser)
          ?.filter((event) => event.type === "case.access_changed"),
      ).toHaveLength(0);

      const historyResponse = await harness.app.inject({
        method: "GET",
        url: `/v1/cases/${transferCase.id}/access-history?limit=20`,
        headers:
          winner === firstCandidate.id
            ? firstCandidate.headers
            : secondCandidate.headers,
      });
      expect(historyResponse.statusCode, historyResponse.body).toBe(200);
      const transfers = historyResponse
        .json<CaseAccessHistoryResponse>()
        .items.filter((event) => event.kind === "OWNER_TRANSFERRED");
      expect(transfers).toHaveLength(1);
      expect(transfers[0]).toMatchObject({
        subject: { id: winner },
        previousSubject: { id: owner.id },
      });
    } finally {
      for (const unsubscribe of unsubscribes) unsubscribe();
    }
  });
});
