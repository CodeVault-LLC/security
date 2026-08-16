import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  AssetDetail,
  AssetMetricsResponse,
  CaseDetail,
  FindingDetail,
  MetricsResponse,
} from "@codevault/contracts";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

/**
 * Metrics.
 *
 * The property this file exists for is scope isolation. Every other assertion
 * here is about arithmetic; that one is about disclosure. An aggregate over
 * rows the caller cannot read is still a leak — arguably a worse one, because a
 * count cannot be redacted after the fact, and a researcher reading "3 critical"
 * has learned something true about a case they were never granted.
 *
 * Note what "cannot read" means here. CodeVault is a shared workspace:
 * `readableCaseIdsSubquery` grants every member read on every *non-restricted*
 * case, and only restricted cases are walled off. So the assertion is not "an
 * outsider sees nothing" — they legitimately see the shared corpus — it is
 * "an outsider sees nothing *of the restricted case*".
 *
 * Measuring that is harder than it looks. The harness runs against a persistent
 * database that accumulates rows across runs, and Vitest runs test files in
 * parallel, so absolute counts and even before/after deltas are both unstable —
 * another file can insert a non-restricted case between the two reads.
 *
 * So isolation is measured two ways, both immune to that:
 *
 *   - **Markers.** A weakness class and an asset that exist only in the
 *     restricted case. Either appearing in an outsider's response is a leak,
 *     whatever else is in the database.
 *   - **Owner minus outsider.** Read as the outsider first, then as the owner.
 *     Anything a concurrent test adds is non-restricted and therefore visible
 *     to both, so it cancels; the restricted case is visible only to the owner.
 *     The difference must account for the restricted findings, and no bucket
 *     may ever be larger for the outsider than for the owner.
 */

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

/** A weakness class no other fixture will have used. */
const SECRET_CWE = "CWE-90210";

/** How many findings the restricted case carries. */
const RESTRICTED_FINDINGS = 3;

describeIntegration("metrics", () => {
  let harness: TestHarness;
  let owner: TestUser;
  let outsider: TestUser;
  let ownCase: CaseDetail;
  let asset: AssetDetail;

  const metricsFor = async (
    user: TestUser,
    query = "",
  ): Promise<MetricsResponse> => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/metrics${query}`,
      headers: user.headers,
    });

    expect(response.statusCode).toBe(200);

    return response.json<MetricsResponse>();
  };

  const assetMetricsFor = async (
    user: TestUser,
  ): Promise<AssetMetricsResponse> => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/metrics/assets",
      headers: user.headers,
    });

    expect(response.statusCode).toBe(200);

    return response.json<AssetMetricsResponse>();
  };

  const stageOf = (
    metrics: MetricsResponse,
    stage: "CONTACT_TO_ACKNOWLEDGEMENT",
  ): number =>
    metrics.stages.find((entry) => entry.stage === stage)?.sampleSize ?? 0;

  /**
   * The same moment seen from both sides.
   *
   * The outsider is read first on purpose. Anything a concurrent test file
   * inserts between the two calls is non-restricted, so it can only ever raise
   * the owner's numbers — never leave the outsider ahead and turn a passing
   * inequality into a false failure.
   */
  const bothViews = async (): Promise<{
    hidden: MetricsResponse;
    shown: MetricsResponse;
  }> => {
    const hidden = await metricsFor(outsider);
    const shown = await metricsFor(owner);

    return { hidden, shown };
  };

  /** A disclosure contact, which `VENDOR_CONTACTED` requires to already exist. */
  const recordStakeholder = async (caseId: string): Promise<void> => {
    const created = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/stakeholders`,
      headers: owner.headers,
      payload: { name: "Acme Security", role: "VENDOR_SECURITY" },
    });

    expect(created.statusCode).toBeLessThan(300);
  };

  beforeAll(async () => {
    harness = await createHarness();
    owner = await harness.createUser({ role: "MEMBER" });
    outsider = await harness.createUser({ role: "MEMBER" });

    const createdCase = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: owner.headers,
      payload: {
        title: "Router firmware review",
        profile: "COORDINATED_DISCLOSURE",
        restricted: true,
      },
    });

    ownCase = createdCase.json<CaseDetail>();

    const createdAsset = await harness.app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: owner.headers,
      payload: {
        name: "Acme Router RT-1200",
        kind: "DEVICE",
        caseId: ownCase.id,
      },
    });

    asset = createdAsset.json<AssetDetail>();

    for (const title of [
      "Command injection",
      "Stored XSS",
      "Weak session ID",
    ]) {
      const created = await harness.app.inject({
        method: "POST",
        url: "/v1/findings",
        headers: owner.headers,
        payload: {
          caseId: ownCase.id,
          title,
          primaryAssetId: asset.id,
          initialSeverity: "CRITICAL",
        },
      });

      expect(created.statusCode).toBeLessThan(300);

      const finding = created.json<FindingDetail>();

      const tagged = await harness.app.inject({
        method: "PATCH",
        url: `/v1/findings/${finding.id}`,
        headers: owner.headers,
        payload: {
          cweIds: [SECRET_CWE],
          expectedRevision: finding.revision,
        },
      });

      expect(tagged.statusCode).toBeLessThan(300);
    }
  });

  afterAll(async () => {
    await harness.close();
  });

  it("counts the findings of a case the caller can read", async () => {
    const metrics = await metricsFor(owner);

    expect(metrics.totals.findings).toBeGreaterThanOrEqual(3);
    expect(metrics.severity.critical).toBeGreaterThanOrEqual(3);
  });

  /*
   * The isolation assertions.
   *
   * Each one measures the restricted case's contribution to the outsider's
   * view, which must be zero — including through the joins, where a missing
   * scope clause hides best.
   */
  describe("scope isolation", () => {
    it("withholds the restricted findings from a non-member's totals", async () => {
      const { hidden, shown } = await bothViews();

      expect(
        shown.totals.findings - hidden.totals.findings,
      ).toBeGreaterThanOrEqual(RESTRICTED_FINDINGS);
      expect(
        shown.totals.criticalsUnfixed - hidden.totals.criticalsUnfixed,
      ).toBeGreaterThanOrEqual(RESTRICTED_FINDINGS);
      expect(shown.totals.openCases).toBeGreaterThan(hidden.totals.openCases);
    });

    it("withholds the restricted severities from a non-member", async () => {
      const { hidden, shown } = await bothViews();

      expect(
        shown.severity.critical - hidden.severity.critical,
      ).toBeGreaterThanOrEqual(RESTRICTED_FINDINGS);

      for (const key of Object.keys(
        shown.severity,
      ) as (keyof typeof shown.severity)[]) {
        expect(hidden.severity[key]).toBeLessThanOrEqual(shown.severity[key]);
      }
    });

    it.each(["validation", "disclosure", "priorArt"] as const)(
      "never shows a non-member more than the owner in the %s distribution",
      async (distribution) => {
        const { hidden, shown } = await bothViews();

        const owned = new Map(
          shown[distribution].map((entry) => [entry.state, entry.count]),
        );

        for (const entry of hidden[distribution]) {
          expect(entry.count).toBeLessThanOrEqual(owned.get(entry.state) ?? 0);
        }

        const ownedTotal = shown[distribution].reduce(
          (sum, entry) => sum + entry.count,
          0,
        );
        const hiddenTotal = hidden[distribution].reduce(
          (sum, entry) => sum + entry.count,
          0,
        );

        expect(ownedTotal - hiddenTotal).toBeGreaterThanOrEqual(
          RESTRICTED_FINDINGS,
        );
      },
    );

    it("withholds the restricted findings from a non-member's intake trend", async () => {
      const { hidden, shown } = await bothViews();
      const sum = (metrics: MetricsResponse): number =>
        metrics.trend.reduce((total, point) => total + point.opened, 0);

      expect(sum(shown) - sum(hidden)).toBeGreaterThanOrEqual(
        RESTRICTED_FINDINGS,
      );
    });

    it("never shows a non-member the restricted weakness class", async () => {
      const metrics = await metricsFor(outsider);

      expect(metrics.cwe.map((entry) => entry.cweId)).not.toContain(SECRET_CWE);
    });

    it("shows the restricted weakness class to the owner", async () => {
      const metrics = await metricsFor(owner);

      // The mirror of the assertion above. Without it, a query returning
      // nothing at all would pass the isolation test for the wrong reason.
      expect(metrics.cwe.map((entry) => entry.cweId)).toContain(SECRET_CWE);
    });

    it("never shows a non-member an asset carrying only restricted findings", async () => {
      const metrics = await metricsFor(outsider);

      expect(
        metrics.topAssets.some((entry) => entry.assetId === asset.id),
      ).toBe(false);
    });

    it("attributes no findings to that asset when a non-member asks directly", async () => {
      const response = await harness.app.inject({
        method: "GET",
        url: `/v1/assets/${asset.id}/metrics`,
        headers: outsider.headers,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ total: number }>().total).toBe(0);
    });

    it("excludes the asset from a non-member's asset roll-up", async () => {
      const metrics = await assetMetricsFor(outsider);

      expect(
        metrics.topAssets.some((entry) => entry.assetId === asset.id),
      ).toBe(false);
    });
  });

  describe("distributions", () => {
    it("lists every state in the vocabulary, including unseen ones", async () => {
      const metrics = await metricsFor(owner);

      // An absent bar and a bar of zero mean different things. Every state is
      // present so a reader can tell "none in this state" from "not measured".
      expect(metrics.validation).toHaveLength(6);
      expect(metrics.disclosure).toHaveLength(7);
      expect(metrics.priorArt).toHaveLength(6);
    });

    /*
     * Distributions are current totals, so narrowing the window must not shrink
     * them.
     *
     * Read wide, narrow, wide again. Concurrent test files only ever insert, so
     * each read is greater than or equal to the one before it; a narrow read
     * that sits inside that sandwich is not being windowed. Comparing two reads
     * for equality instead would fail the moment another file inserted a
     * finding between them, which is a property of the test, not of the route.
     */
    it("ignores the window, because a distribution is a current total", async () => {
      const before = await metricsFor(owner, "?window=365d");
      const narrow = await metricsFor(owner, "?window=30d");
      const after = await metricsFor(owner, "?window=365d");

      for (const key of Object.keys(
        before.severity,
      ) as (keyof typeof before.severity)[]) {
        expect(narrow.severity[key]).toBeGreaterThanOrEqual(
          before.severity[key],
        );
        expect(narrow.severity[key]).toBeLessThanOrEqual(after.severity[key]);
      }

      const total = (metrics: MetricsResponse): number =>
        metrics.validation.reduce((sum, entry) => sum + entry.count, 0);

      expect(total(narrow)).toBeGreaterThanOrEqual(total(before));
      expect(total(narrow)).toBeLessThanOrEqual(total(after));

      // The vocabulary itself never varies with the window.
      expect(narrow.validation.map((entry) => entry.state)).toEqual(
        before.validation.map((entry) => entry.state),
      );
      expect(narrow.disclosure.map((entry) => entry.state)).toEqual(
        before.disclosure.map((entry) => entry.state),
      );
    });
  });

  describe("trend", () => {
    it("emits a bucket for every period, including empty ones", async () => {
      const metrics = await metricsFor(owner, "?window=30d");

      expect(metrics.bucket).toBe("day");
      // Daily buckets across thirty days, inclusive of both ends.
      expect(metrics.trend.length).toBeGreaterThanOrEqual(30);

      const quiet = metrics.trend.filter((point) => point.opened === 0);

      expect(quiet.length).toBeGreaterThan(0);
    });

    it("buckets weekly over ninety days and monthly over all time", async () => {
      expect((await metricsFor(owner, "?window=90d")).bucket).toBe("week");
      expect((await metricsFor(owner, "?window=all")).bucket).toBe("month");
    });

    it("returns buckets in ascending order", async () => {
      const metrics = await metricsFor(owner, "?window=90d");
      const timestamps = metrics.trend.map((point) =>
        Date.parse(point.bucketStart),
      );

      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    });

    it("counts the findings created in this window", async () => {
      const metrics = await metricsFor(owner, "?window=30d");
      const opened = metrics.trend.reduce(
        (sum, point) => sum + point.opened,
        0,
      );

      expect(opened).toBeGreaterThanOrEqual(3);
    });
  });

  describe("disclosure stages", () => {
    it("reports every stage, unmeasured ones as null rather than zero", async () => {
      const metrics = await metricsFor(owner);

      expect(metrics.stages).toHaveLength(3);

      for (const stage of metrics.stages) {
        if (stage.sampleSize === 0) {
          // Zero days and "never measured" are different claims. Only one of
          // them is true, and it is not "this vendor replied instantly".
          expect(stage.p50Days).toBeNull();
          expect(stage.p90Days).toBeNull();
        } else {
          expect(stage.p50Days).not.toBeNull();
        }
      }
    });

    it("takes one more sample once both events exist on a case", async () => {
      const before = stageOf(
        await metricsFor(owner),
        "CONTACT_TO_ACKNOWLEDGEMENT",
      );

      // The API refuses to log a vendor contact before a contact exists to be
      // logged against — the timeline is a record of fact, not a checklist.
      await recordStakeholder(ownCase.id);

      for (const [type, daysAgo] of [
        ["VENDOR_CONTACTED", 5],
        ["VENDOR_ACKNOWLEDGED", 3],
      ] as const) {
        const recorded = await harness.app.inject({
          method: "POST",
          url: `/v1/cases/${ownCase.id}/disclosure-events`,
          headers: owner.headers,
          payload: {
            type,
            visibility: "INTERNAL",
            occurredAt: new Date(
              Date.now() - daysAgo * 86_400_000,
            ).toISOString(),
          },
        });

        expect(recorded.statusCode).toBeLessThan(300);
      }

      const after = stageOf(
        await metricsFor(owner),
        "CONTACT_TO_ACKNOWLEDGEMENT",
      );

      expect(after).toBe(before + 1);
    });

    it("does not count a case that has only one end of the pair", async () => {
      const before = stageOf(
        await metricsFor(owner),
        "CONTACT_TO_ACKNOWLEDGEMENT",
      );

      const other = await harness.app.inject({
        method: "POST",
        url: "/v1/cases",
        headers: owner.headers,
        payload: {
          title: "Contacted, never answered",
          profile: "STANDARD",
          restricted: true,
        },
      });

      const orphanId = other.json<CaseDetail>().id;

      await recordStakeholder(orphanId);

      const contacted = await harness.app.inject({
        method: "POST",
        url: `/v1/cases/${orphanId}/disclosure-events`,
        headers: owner.headers,
        payload: {
          type: "VENDOR_CONTACTED",
          visibility: "INTERNAL",
          occurredAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
        },
      });

      expect(contacted.statusCode).toBeLessThan(300);

      const after = stageOf(
        await metricsFor(owner),
        "CONTACT_TO_ACKNOWLEDGEMENT",
      );

      // A vendor who never replied must not improve the median, and must not
      // silently count as a zero-day turnaround.
      expect(after).toBe(before);
    });

    it("suppresses the headline median only below three samples", async () => {
      const metrics = await metricsFor(owner);
      const stage = metrics.stages.find(
        (entry) => entry.stage === "CONTACT_TO_ACKNOWLEDGEMENT",
      );

      // Stated as the rule rather than as a fixed number, so the assertion
      // holds whatever else the shared database happens to contain.
      if ((stage?.sampleSize ?? 0) < 3) {
        expect(metrics.totals.medianAcknowledgementDays).toBeNull();
      } else {
        expect(metrics.totals.medianAcknowledgementDays).toBe(stage?.p50Days);
      }
    });
  });

  describe("assets", () => {
    it("attributes findings to the asset they were filed against", async () => {
      const metrics = await metricsFor(owner);
      const entry = metrics.topAssets.find(
        (candidate) => candidate.assetId === asset.id,
      );

      expect(entry?.total).toBe(3);
      expect(entry?.severity.critical).toBe(3);
    });

    it("reports identifier coverage across the workspace", async () => {
      const metrics = await assetMetricsFor(owner);

      expect(metrics.identifierCoverage.total).toBeGreaterThanOrEqual(1);
      expect(metrics.identifierCoverage.withIdentifier).toBeLessThanOrEqual(
        metrics.identifierCoverage.total,
      );
      expect(metrics.identifierCoverage.withPrimary).toBeLessThanOrEqual(
        metrics.identifierCoverage.withIdentifier,
      );
    });

    it("lists every asset kind, including those with nothing recorded", async () => {
      const metrics = await assetMetricsFor(owner);

      expect(metrics.byKind).toHaveLength(12);
      expect(metrics.byKind.some((entry) => entry.kind === "DEVICE")).toBe(
        true,
      );
    });
  });

  it("returns empty collections rather than nulls on a fresh view", async () => {
    const metrics = await metricsFor(outsider);

    expect(Array.isArray(metrics.trend)).toBe(true);
    expect(Array.isArray(metrics.cwe)).toBe(true);
    expect(Array.isArray(metrics.topAssets)).toBe(true);
    expect(metrics.stages).toHaveLength(3);
  });
});
