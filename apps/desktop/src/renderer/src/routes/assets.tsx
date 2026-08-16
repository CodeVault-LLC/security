import { Link } from "@tanstack/react-router";
import { ListFilter, Plus } from "lucide-react";
import { useState } from "react";

import type {
  AssetDetail,
  AssetDetailMetricsResponse,
  AssetMetricsResponse,
  AssetSummary,
} from "@codevault/contracts";
import {
  ASSET_IDENTIFIER_SCHEMES,
  ASSET_KINDS,
  ASSET_RELATIONSHIPS,
  type AssetIdentifierScheme,
  type AssetKind,
} from "@codevault/core";
import {
  assetKindSelectOptions,
  AssetKindIcon,
  BarList,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LoadingState,
  Meter,
  Mono,
  Select,
  severityChartSegments,
  StackedBar,
  Textarea,
  TrendChart,
} from "@codevault/ui";

import { PageHeader } from "../components/app-shell.js";
import { QueryError } from "../components/query-boundary.js";
import { formatDate } from "../lib/dates.js";
import { humanise } from "../lib/format.js";
import {
  errorHeading,
  queryKeys,
  useApiMutation,
  useApiQuery,
} from "../lib/api.js";
import { canWrite, useSession } from "../lib/session.js";
import { formatBucket } from "./metrics.js";

/**
 * Assets.
 *
 * Twelve kinds, none of them tied to an ecosystem. A WordPress plugin is a
 * software component with a `pkg:wordpress/...` identifier; a camera is a
 * device with firmware related to it. That is what keeps this list usable for
 * research that is not web application testing.
 */

interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * What each identifier scheme actually is.
 *
 * The codes are the industry's own and stay as the label, because that is what
 * a researcher pastes from a CPE dictionary or a package URL. The expansion
 * goes underneath, so the list is readable by someone meeting SWID for the
 * first time without being condescending to someone who is not.
 */
const SCHEME_DESCRIPTIONS: Record<AssetIdentifierScheme, string> = {
  CPE23: "Common Platform Enumeration 2.3",
  PURL: "Package URL, e.g. pkg:npm/left-pad",
  SWID: "Software identification tag",
  REPOSITORY_URL: "Source repository address",
  VENDOR_PRODUCT: "Vendor and product name",
  MODEL: "Manufacturer model number",
  SERIAL: "Serial number of one unit",
  CUSTOM: "Anything else, described in the notes",
};

export function AssetsRoute(): React.JSX.Element {
  const user = useSession((state) => state.user);
  const [createOpen, setCreateOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState<string>("");

  const assets = useApiQuery<Paginated<AssetSummary>>(
    queryKeys.assets({ kind: kindFilter }),
    kindFilter.length === 0
      ? "/v1/assets?limit=200"
      : `/v1/assets?kind=${kindFilter}&limit=200`,
  );

  const metrics = useApiQuery<AssetMetricsResponse>(
    queryKeys.assetMetrics,
    "/v1/metrics/assets",
  );

  const items = assets.data?.items ?? [];
  const stats = metrics.data;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Assets"
        description="Software, applications, services, devices, firmware, hosts and cloud resources."
        actions={
          canWrite(user) ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden className="size-3.5" />
              New asset
            </Button>
          ) : undefined
        }
      />

      <div className="border-b border-border p-4">
        <QueryError query={metrics} className="mb-3" />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Findings by kind</CardTitle>
            </CardHeader>
            <CardBody>
              {stats === undefined ? (
                <LoadingState className="py-2" />
              ) : (
                <BarList
                  caption="Findings by asset kind"
                  items={stats.byKind
                    .filter((entry) => entry.findingCount > 0)
                    .sort((a, b) => b.findingCount - a.findingCount)
                    .slice(0, 6)
                    .map((entry) => ({
                      key: entry.kind,
                      label: humanise(entry.kind),
                      value: entry.findingCount,
                    }))}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Most affected</CardTitle>
            </CardHeader>
            <CardBody>
              {stats === undefined ? (
                <LoadingState className="py-2" />
              ) : (
                <BarList
                  caption="Assets by finding count"
                  items={stats.topAssets.slice(0, 6).map((entry) => ({
                    key: entry.assetId,
                    label: entry.name,
                    value: entry.total,
                  }))}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Identifier coverage</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              {stats === undefined ? (
                <LoadingState className="py-2" />
              ) : (
                <>
                  <Meter
                    label="Any identifier"
                    value={stats.identifierCoverage.withIdentifier}
                    total={stats.identifierCoverage.total}
                  />
                  <Meter
                    label="Primary identifier"
                    value={stats.identifierCoverage.withPrimary}
                    total={stats.identifierCoverage.total}
                  />
                  {/* Not a vanity figure: prior-art matching is far more
                      accurate against a PURL or CPE than a product name, so
                      this number is a piece of work rather than a score. */}
                  <p className="text-[11px] text-text-muted">
                    A PURL or CPE makes prior-art matching far more accurate
                    than a product name.
                  </p>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Select
          aria-label="Asset kind"
          value={kindFilter.length === 0 ? "__all" : kindFilter}
          onValueChange={(value) =>
            setKindFilter(value === "__all" ? "" : value)
          }
          className="w-56"
          options={[
            {
              value: "__all",
              label: "All kinds",
              icon: <ListFilter className="size-3.5" />,
            },
            ...assetKindSelectOptions(ASSET_KINDS),
          ]}
        />
        <span className="ml-auto text-[11px] text-text-muted">
          {items.length} asset{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {assets.error !== null ? (
        <ErrorState
          title={errorHeading(assets.error)}
          description={assets.error.message}
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={assets.isFetching}
              onClick={() => void assets.refetch()}
            >
              Try again
            </Button>
          }
        />
      ) : assets.isLoading ? (
        <LoadingState label="Loading assets…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No assets yet"
          description="Create the thing you are researching: a component, a device, a service or a firmware image."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="divide-y divide-border">
            {items.map((asset) => (
              <li key={asset.id}>
                <Link
                  to={`/assets/${asset.id}`}
                  className="flex items-center gap-2 px-4 py-2 text-[12px] hover:bg-surface-hover"
                >
                  <AssetKindIcon kind={asset.kind} />
                  <Mono className="w-24 shrink-0 text-text-muted">
                    {asset.ref}
                  </Mono>
                  <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                  <span className="w-40 shrink-0 truncate text-text-muted">
                    {asset.vendor ?? "—"}
                  </span>
                  <span className="w-24 shrink-0 truncate text-text-muted">
                    {asset.version ?? "—"}
                  </span>
                  <Mono className="w-64 shrink-0 truncate text-text-muted">
                    {asset.primaryIdentifier ?? ""}
                  </Mono>
                  <span className="w-16 shrink-0 text-right text-text-muted">
                    {asset.findingCount} finding
                    {asset.findingCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <CreateAssetDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

export function AssetDetailRoute({
  assetId,
}: {
  assetId: string;
}): React.JSX.Element {
  const asset = useApiQuery<AssetDetail>(
    queryKeys.asset(assetId),
    `/v1/assets/${assetId}`,
  );

  const metrics = useApiQuery<AssetDetailMetricsResponse>(
    queryKeys.assetDetailMetrics(assetId),
    `/v1/assets/${assetId}/metrics`,
  );

  if (asset.isLoading) {
    return <LoadingState label="Loading asset…" />;
  }

  if (asset.error !== null || asset.data === undefined) {
    return (
      <ErrorState
        title={errorHeading(asset.error)}
        description={asset.error?.message ?? "That asset could not be loaded."}
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={asset.isFetching}
            onClick={() => void asset.refetch()}
          >
            Try again
          </Button>
        }
      />
    );
  }

  const data = asset.data;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <AssetKindIcon kind={data.kind} />
          <Mono className="text-text-muted">{data.ref}</Mono>
          <span className="rounded border border-border px-1 text-[10px] uppercase text-text-muted">
            {humanise(data.kind)}
          </span>
        </div>
        <h1 className="mt-0.5 text-[15px] font-semibold">{data.name}</h1>
        <p className="text-[12px] text-text-muted">
          {data.vendor ?? "Vendor unknown"}
          {data.version === null ? "" : ` · ${data.version}`}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <QueryError query={metrics} className="mb-4" />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Findings</CardTitle>
              <span className="text-[11px] text-text-muted">
                {metrics.data?.total ?? 0} against this asset
              </span>
            </CardHeader>
            <CardBody>
              {metrics.data === undefined ? (
                <LoadingState className="py-2" />
              ) : metrics.data.total === 0 ? (
                <p className="text-[12px] text-text-muted">
                  No findings are recorded against this asset yet.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-1">
                    <StackedBar
                      caption={`Findings against ${data.name} by severity`}
                      segments={severityChartSegments(metrics.data.severity)}
                    />
                  </div>

                  <div className="lg:col-span-1">
                    <TrendChart
                      caption={`Findings opened against ${data.name}`}
                      buckets={metrics.data.trend.map((point) =>
                        formatBucket(
                          point.bucketStart,
                          metrics.data?.bucket ?? "week",
                        ),
                      )}
                      series={[
                        {
                          key: "opened",
                          label: "Opened",
                          color: "--cv-accent",
                          points: metrics.data.trend.map(
                            (point) => point.opened,
                          ),
                        },
                      ]}
                    />
                  </div>

                  <div className="flex flex-col justify-center gap-2 lg:col-span-1">
                    {/* Pairs with the dashboard's "unverified affected
                        versions" alert, so the two agree about what is
                        outstanding rather than counting it differently. */}
                    <Meter
                      label="Version ranges verified"
                      value={metrics.data.affectedRanges.verified}
                      total={metrics.data.affectedRanges.total}
                    />
                    {metrics.data.affectedRanges.inferredUnverified ===
                    0 ? null : (
                      <p className="text-[11px] text-warning">
                        {metrics.data.affectedRanges.inferredUnverified}{" "}
                        inferred range
                        {metrics.data.affectedRanges.inferredUnverified === 1
                          ? " has"
                          : "s have"}{" "}
                        never been verified.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Identifiers</CardTitle>
            </CardHeader>
            {data.identifiers.length === 0 ? (
              <CardBody className="text-[12px] text-text-muted">
                None recorded. A PURL or CPE makes prior-art matching far more
                accurate than a product name.
              </CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {data.identifiers.map((identifier) => (
                  <li
                    key={identifier.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
                  >
                    <span className="w-28 shrink-0 text-text-muted">
                      {identifier.scheme}
                    </span>
                    <Mono className="min-w-0 flex-1 truncate">
                      {identifier.value}
                    </Mono>
                    {identifier.primary ? (
                      <span className="text-[10px] uppercase text-accent">
                        Primary
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Versions</CardTitle>
            </CardHeader>
            {data.versions.length === 0 ? (
              <CardBody className="text-[12px] text-text-muted">
                No versions recorded.
              </CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {data.versions.map((version) => (
                  <li
                    key={version.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
                  >
                    <Mono className="flex-1">{version.version}</Mono>
                    <span className="text-text-muted">
                      {formatDate(version.releasedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Relationships</CardTitle>
            </CardHeader>
            {data.relationships.length === 0 ? (
              <CardBody className="text-[12px] text-text-muted">
                No relationships. A device relates to its firmware; firmware
                contains components; a service runs on a host.
              </CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {data.relationships.map((relationship) => (
                  <li
                    key={relationship.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
                  >
                    <span className="w-32 shrink-0 text-text-muted">
                      {humanise(relationship.relationship)}
                    </span>
                    <AssetKindIcon kind={relationship.toAssetKind} />
                    <Link
                      to={`/assets/${relationship.toAssetId}`}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {relationship.toAssetName}
                    </Link>
                    {relationship.note === null ? null : (
                      <span className="text-text-muted">
                        {relationship.note}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function CreateAssetDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssetKind>("SOFTWARE_COMPONENT");
  const [vendor, setVendor] = useState("");
  const [version, setVersion] = useState("");
  const [scheme, setScheme] = useState<string>("PURL");
  const [identifier, setIdentifier] = useState("");
  const [notes, setNotes] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useApiMutation<AssetDetail>(
    () => ({
      path: "/v1/assets",
      method: "POST",
      body: {
        name: name.trim(),
        kind,
        ...(vendor.trim().length === 0 ? {} : { vendor: vendor.trim() }),
        ...(version.trim().length === 0 ? {} : { version: version.trim() }),
        ...(identifier.trim().length === 0
          ? {}
          : { identifier: { scheme, value: identifier.trim() } }),
        ...(notes.trim().length === 0 ? {} : { notes: notes.trim() }),
      },
    }),
    () => [queryKeys.assets()],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New asset"
        description="Name it and pick a kind. Identifiers, versions and relationships can follow."
      >
        <DialogBody className="space-y-3">
          <div>
            <Label htmlFor="asset-name">Name</Label>
            <Input
              id="asset-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Router RT-1200"
              autoFocus
              className="mt-1"
            />
          </div>

          <div>
            <Label>Kind</Label>
            <Select
              aria-label="Asset kind"
              value={kind}
              onValueChange={(value) => setKind(value as AssetKind)}
              className="mt-1"
              options={assetKindSelectOptions(ASSET_KINDS)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="asset-vendor">Vendor (optional)</Label>
              <Input
                id="asset-vendor"
                value={vendor}
                onChange={(event) => setVendor(event.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="asset-version">Version / model (optional)</Label>
              <Input
                id="asset-version"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <button
            type="button"
            className="text-[11px] text-text-muted hover:text-text"
            onClick={() => setShowAdvanced((current) => !current)}
          >
            {showAdvanced ? "Hide" : "Show"} identifier and notes
          </button>

          {showAdvanced ? (
            <div className="space-y-3 rounded-(--cv-radius) border border-border p-2">
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <div>
                  <Label>Scheme</Label>
                  <Select
                    aria-label="Identifier scheme"
                    value={scheme}
                    onValueChange={setScheme}
                    className="mt-1"
                    options={ASSET_IDENTIFIER_SCHEMES.map((value) => ({
                      value,
                      label: value,
                      description: SCHEME_DESCRIPTIONS[value],
                    }))}
                  />
                </div>
                <div>
                  <Label htmlFor="asset-identifier">Identifier</Label>
                  <Input
                    id="asset-identifier"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder="pkg:wordpress/hummingbird-performance"
                    className="mt-1 font-mono"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="asset-notes">Notes</Label>
                <Textarea
                  id="asset-notes"
                  value={notes}
                  rows={3}
                  onChange={(event) => setNotes(event.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
          ) : null}

          {error === null ? null : (
            <p className="text-[12px] text-danger">{error}</p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={name.trim().length === 0 || create.isPending}
            onClick={() =>
              create.mutate(undefined, {
                onSuccess: () => {
                  onOpenChange(false);
                  setName("");
                  setVendor("");
                  setVersion("");
                  setIdentifier("");
                  setNotes("");
                },
                onError: (mutationError) => setError(mutationError.message),
              })
            }
          >
            Create asset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ASSET_RELATIONSHIPS };
