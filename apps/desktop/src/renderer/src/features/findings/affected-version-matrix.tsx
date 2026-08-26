import type { AffectedRange, FindingAsset } from "@codevault/contracts";
import { Mono } from "@codevault/ui";

import { formatDateTime } from "../../lib/dates.js";

export interface AffectedVersionMatrixRow {
  asset: FindingAsset;
  range: AffectedRange | null;
}

export function buildAffectedVersionMatrix(
  assets: readonly FindingAsset[],
  ranges: readonly AffectedRange[],
): AffectedVersionMatrixRow[] {
  const rows: AffectedVersionMatrixRow[] = [];
  for (const asset of assets) {
    const assetRanges = ranges.filter(
      (range) => range.assetId === asset.assetId,
    );
    if (assetRanges.length === 0) rows.push({ asset, range: null });
    else rows.push(...assetRanges.map((range) => ({ asset, range })));
  }
  return rows;
}

export function AffectedVersionMatrix({
  assets,
  ranges,
}: {
  assets: readonly FindingAsset[];
  ranges: readonly AffectedRange[];
}): React.JSX.Element {
  const rows = buildAffectedVersionMatrix(assets, ranges);
  const assetsWithConclusions = new Set(ranges.map((range) => range.assetId));
  const gaps = assets.filter(
    (asset) => !assetsWithConclusions.has(asset.assetId),
  ).length;
  const unverified = ranges.filter((range) => range.verifiedAt === null).length;

  return (
    <div className="overflow-hidden rounded-(--cv-radius) border border-border">
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border bg-surface-raised px-3 py-2 text-[11px] text-text-muted">
        <span>
          {assetsWithConclusions.size} of {assets.length} assets covered
        </span>
        {gaps === 0 ? null : (
          <span className="text-warning">
            {gaps} gap{gaps === 1 ? "" : "s"}
          </span>
        )}
        {unverified === 0 ? null : (
          <span className="text-warning">
            {unverified} unverified conclusion{unverified === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
          <thead className="bg-background text-text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Asset</th>
              <th className="px-3 py-2 font-medium">Range</th>
              <th className="px-3 py-2 font-medium">Conclusion</th>
              <th className="px-3 py-2 font-medium">Fixed in</th>
              <th className="px-3 py-2 font-medium">Verification</th>
              <th className="px-3 py-2 font-medium">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ asset, range }, index) => (
              <tr key={range?.id ?? `${asset.assetId}-${index}`}>
                <td className="px-3 py-2 align-top">
                  <span className="block font-medium">{asset.name}</span>
                  <Mono className="text-[10px] text-text-muted">
                    {asset.assetRef}
                  </Mono>
                  {asset.primary ? (
                    <span className="ml-1 text-[9px] uppercase text-accent">
                      Primary
                    </span>
                  ) : null}
                </td>
                {range === null ? (
                  <td className="px-3 py-2 text-warning" colSpan={5}>
                    No affected-version conclusion recorded for this asset.
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-2 align-top">
                      <Mono>{range.expression}</Mono>
                      <span className="mt-0.5 block text-[10px] text-text-muted">
                        {range.kind.replaceAll("_", " ").toLowerCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={statusClass(range.status)}>
                        {range.status.replaceAll("_", " ").toLowerCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {range.fixedIn === null ? (
                        "—"
                      ) : (
                        <Mono>{range.fixedIn}</Mono>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {range.verifiedAt === null ? (
                        <span className="text-warning">Not verified</span>
                      ) : (
                        formatDateTime(range.verifiedAt)
                      )}
                    </td>
                    <td className="max-w-64 px-3 py-2 align-top text-text-muted">
                      {range.evidenceNote ?? "—"}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function statusClass(status: AffectedRange["status"]): string {
  if (status === "CONFIRMED_VULNERABLE") return "text-danger";
  if (status === "CONFIRMED_NOT_VULNERABLE" || status === "CONFIRMED_FIXED")
    return "text-success";
  return "text-warning";
}
