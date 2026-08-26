import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  CaseDetail,
  Evidence,
  EvidenceCustodyEvent,
} from "@codevault/contracts";
import { uuidv7 } from "@codevault/core/crypto";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("evidence custody attestations", () => {
  let harness: TestHarness;
  let user: TestUser;
  let evidence: Evidence;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser();
    const researchCase = (
      await harness.app.inject({
        method: "POST",
        url: "/v1/cases",
        headers: user.headers,
        payload: { title: `Custody ${uuidv7()}`, profile: "STANDARD" },
      })
    ).json<CaseDetail>();
    evidence = (
      await harness.app.inject({
        method: "POST",
        url: "/v1/evidence",
        headers: user.headers,
        payload: {
          caseId: researchCase.id,
          title: "Acquired device image",
          visibility: "INTERNAL",
        },
      })
    ).json<Evidence>();
  });

  afterAll(async () => harness.close());

  it("builds a verifiable append-only hash chain", async () => {
    const firstResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/evidence/${evidence.id}/custody`,
      headers: user.headers,
      payload: {
        eventType: "COLLECTED",
        custodian: "Research lab safe",
        note: "Bag seal A-104",
        occurredAt: "2026-08-26T09:00:00.000Z",
      },
    });
    expect(firstResponse.statusCode).toBe(200);
    const first = firstResponse.json<EvidenceCustodyEvent>();
    expect(first.previousEventHash).toBeNull();

    const expectedFirstHash = createHash("sha256")
      .update(
        JSON.stringify({
          version: 1,
          evidenceId: evidence.id,
          artifactId: null,
          eventType: "COLLECTED",
          custodian: "Research lab safe",
          note: "Bag seal A-104",
          occurredAt: "2026-08-26T09:00:00.000Z",
          attestedBy: user.id,
          previousEventHash: null,
        }),
        "utf8",
      )
      .digest("hex");
    expect(first.eventHash).toBe(expectedFirstHash);

    const second = (
      await harness.app.inject({
        method: "POST",
        url: `/v1/evidence/${evidence.id}/custody`,
        headers: user.headers,
        payload: {
          eventType: "VERIFIED",
          custodian: "Forensics reviewer",
          occurredAt: "2026-08-26T10:00:00.000Z",
        },
      })
    ).json<EvidenceCustodyEvent>();
    expect(second.previousEventHash).toBe(first.eventHash);

    const listed = await harness.app.inject({
      method: "GET",
      url: `/v1/evidence/${evidence.id}/custody`,
      headers: user.headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(
      listed.json<EvidenceCustodyEvent[]>().map((event) => event.eventType),
    ).toEqual(["COLLECTED", "VERIFIED"]);
  });
});
