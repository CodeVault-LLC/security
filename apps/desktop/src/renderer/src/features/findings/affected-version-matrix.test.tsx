import { describe, expect, it } from "vitest";

import type { AffectedRange, FindingAsset } from "@codevault/contracts";

import { buildAffectedVersionMatrix } from "./affected-version-matrix.js";

const assets: FindingAsset[] = [
  {
    assetId: "00000000-0000-4000-8000-000000000001",
    assetRef: "ASSET-001",
    name: "API",
    kind: "SERVICE",
    primary: true,
  },
  {
    assetId: "00000000-0000-4000-8000-000000000002",
    assetRef: "ASSET-002",
    name: "Client",
    kind: "APPLICATION",
    primary: false,
  },
];

const range: AffectedRange = {
  id: "00000000-0000-4000-8000-000000000003",
  assetId: assets[0]!.assetId,
  kind: "SEMVER_RANGE",
  expression: ">=1.0.0 <1.4.2",
  status: "CONFIRMED_VULNERABLE",
  fixedIn: "1.4.2",
  evidenceNote: "Reproduced in the test environment.",
  verifiedAt: "2026-08-26T10:00:00.000Z",
  createdAt: "2026-08-26T10:00:00.000Z",
};

describe("affected version matrix", () => {
  it("keeps uncovered linked assets visible as explicit gaps", () => {
    const rows = buildAffectedVersionMatrix(assets, [range]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ asset: assets[0], range });
    expect(rows[1]).toEqual({ asset: assets[1], range: null });
  });

  it("creates one comparison row per conclusion for the same asset", () => {
    expect(
      buildAffectedVersionMatrix(
        [assets[0]!],
        [range, { ...range, id: "00000000-0000-4000-8000-000000000004" }],
      ),
    ).toHaveLength(2);
  });
});
