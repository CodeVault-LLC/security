import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PriorArtQuery } from "@codevault/core";
import { uuidv7 } from "@codevault/core/crypto";
import { allocateReference, createDatabase, schema } from "@codevault/db";
import type { DatabaseHandle } from "@codevault/db";

import { searchInternal } from "./internal-search.js";

/**
 * Internal prior-art search.
 *
 * This runs against a real database on purpose. The query mixes full-text
 * ranking, trigram similarity, a JSONB containment operator and two array
 * parameters, and none of that is exercised by building the SQL alone — an
 * empty CWE or CVE list is the ordinary state of a new finding, and it has to
 * survive the round trip rather than fail in a background job where nobody is
 * watching.
 *
 * Skipped unless `DATABASE_URL` points at a migrated development database.
 */

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

function query(overrides: Partial<PriorArtQuery> = {}): PriorArtQuery {
  return {
    identity: {
      vendor: "acme networks",
      product: "rt 1200 firmware",
      ecosystem: null,
      packageName: null,
    },
    title: "Unauthenticated command injection in the update handler",
    cweIds: [],
    cveIds: [],
    keywords: [],
    limit: 10,
    ...overrides,
  };
}

describeIntegration("internal prior-art search", () => {
  let handle: DatabaseHandle;
  let caseId: string;
  let priorFindingId: string;
  let subjectFindingId: string;

  beforeAll(async () => {
    handle = createDatabase({ connectionString: connectionString as string });

    const [owner] = await handle.db
      .insert(schema.users)
      .values({
        email: `prior-art-${uuidv7()}@codevault.test`,
        displayName: "Prior Art Fixture",
        passwordHash: "not-a-real-hash",
        role: "MEMBER",
      })
      .returning({ id: schema.users.id });

    if (owner === undefined) {
      throw new Error("Could not create the fixture user.");
    }

    const caseRef = await allocateReference(handle.db, "case");
    const [fixtureCase] = await handle.db
      .insert(schema.cases)
      .values({
        ref: caseRef,
        title: "Prior-art search fixture",
        profile: "STANDARD",
        ownerId: owner.id,
      })
      .returning({ id: schema.cases.id });

    if (fixtureCase === undefined) {
      throw new Error("Could not create the fixture case.");
    }

    caseId = fixtureCase.id;

    const priorRef = await allocateReference(handle.db, "finding");
    const [prior] = await handle.db
      .insert(schema.findings)
      .values({
        ref: priorRef,
        caseId,
        title: "Unauthenticated command injection in the update handler",
        summaryMarkdown: "An older report of the same defect class.",
        cweIds: ["CWE-78"],
        ownerId: owner.id,
      })
      .returning({ id: schema.findings.id });

    const subjectRef = await allocateReference(handle.db, "finding");
    const [subject] = await handle.db
      .insert(schema.findings)
      .values({
        ref: subjectRef,
        caseId,
        title: "Unauthenticated command injection in the update handler",
        ownerId: owner.id,
      })
      .returning({ id: schema.findings.id });

    if (prior === undefined || subject === undefined) {
      throw new Error("Could not create the fixture findings.");
    }

    priorFindingId = prior.id;
    subjectFindingId = subject.id;

    await handle.db.insert(schema.findingIdentifiers).values({
      findingId: priorFindingId,
      scheme: "CVE",
      value: "CVE-2024-31337",
      createdBy: owner.id,
    });
  });

  afterAll(async () => {
    await handle.db.execute(
      sql`DELETE FROM cases WHERE id = ${caseId ?? uuidv7()}`,
    );

    await handle.close();
  });

  it("finds a similar earlier finding for a query with no CWE and no CVE", async () => {
    const matches = await searchInternal(
      handle.db,
      subjectFindingId,
      query({ cweIds: [], cveIds: [] }),
    );

    expect(matches.map((match) => match.findingId)).toContain(priorFindingId);
  });

  it("never returns the finding being checked", async () => {
    const matches = await searchInternal(handle.db, subjectFindingId, query());

    expect(matches.map((match) => match.findingId)).not.toContain(
      subjectFindingId,
    );
  });

  it("accepts several CWE and CVE identifiers at once", async () => {
    const matches = await searchInternal(
      handle.db,
      subjectFindingId,
      query({
        cweIds: ["CWE-78", "CWE-77"],
        cveIds: ["cve-2024-31337", "CVE-2024-1"],
      }),
    );

    const match = matches.find((it) => it.findingId === priorFindingId);

    // The CVE is an exact identifier match, which outranks any text similarity.
    expect(match?.localSimilarity).toBeGreaterThanOrEqual(0.9);
  });

  it("records the query it ran so the check can be audited later", async () => {
    const matches = await searchInternal(
      handle.db,
      subjectFindingId,
      query({ cweIds: ["CWE-78"] }),
    );

    expect(matches[0]?.query).toContain("cwe(CWE-78)");
    expect(matches[0]?.provider).toBe("CODEVAULT");
  });
});
