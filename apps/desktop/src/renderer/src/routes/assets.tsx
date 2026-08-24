import { Link, useSearch } from "@tanstack/react-router";
import { FilePlus2, ListFilter, Pencil, Plus, Search, X } from "lucide-react";
import { useState } from "react";

import type {
  AssetDetail,
  AssetDetailMetricsResponse,
  AssetMetricsResponse,
  AssetRegistryResult,
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
  InlineError,
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
import {
  RegistrySearchDialog,
  registryResultToAssetDraft,
} from "../features/assets/registry-search-dialog.js";
import { CreateFindingDialog } from "../features/findings/create-finding-dialog.js";
import {
  VendorDialog,
  VendorPicker,
} from "../features/vendors/vendor-dialog.js";
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
  const routeSearch = useSearch({ from: "/assets" });
  const user = useSession((state) => state.user);
  const [createOpen, setCreateOpen] = useState(routeSearch.create);
  const [kindFilter, setKindFilter] = useState<string>("");
  const [limit, setLimit] = useState(200);
  const vendorFilter = routeSearch.vendorId;

  const assetQuery = new URLSearchParams({ limit: String(limit) });

  if (kindFilter.length > 0) assetQuery.set("kind", kindFilter);
  if (vendorFilter !== undefined) assetQuery.set("vendorId", vendorFilter);

  const assets = useApiQuery<Paginated<AssetSummary>>(
    queryKeys.assets({ kind: kindFilter, vendorId: vendorFilter, limit }),
    `/v1/assets?${assetQuery.toString()}`,
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
        description={
          vendorFilter === undefined
            ? "Software, applications, services, devices, firmware, hosts and cloud resources."
            : `Assets linked to ${routeSearch.vendorName ?? "this vendor"}.`
        }
        actions={
          canWrite(user) ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden className="size-3.5" />
              New asset
            </Button>
          ) : undefined
        }
      />

      <details className="group border-b border-border px-4 py-2">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-(--cv-radius) text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          <span>Asset analysis</span>
          <span className="text-[11px] font-normal text-text-muted group-open:hidden">
            Findings and identifier coverage
          </span>
          <span className="hidden text-[11px] font-normal text-text-muted group-open:inline">
            Hide analysis
          </span>
        </summary>

        {metrics.error !== null ? (
          <ErrorState
            title={errorHeading(metrics.error)}
            description={metrics.error.message}
            action={
              <Button
                variant="secondary"
                loading={metrics.isFetching}
                onClick={() => void metrics.refetch()}
              >
                Try again
              </Button>
            }
          />
        ) : metrics.isLoading ? (
          <LoadingState label="Loading asset analysis…" />
        ) : stats === undefined ? null : (
          <div className="grid grid-cols-1 gap-4 py-3 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Findings by kind</CardTitle>
              </CardHeader>
              <CardBody>
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
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Most affected</CardTitle>
              </CardHeader>
              <CardBody>
                <BarList
                  caption="Assets by finding count"
                  items={stats.topAssets.slice(0, 6).map((entry) => ({
                    key: entry.assetId,
                    label: entry.name,
                    value: entry.total,
                  }))}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Identifier coverage</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2">
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
              </CardBody>
            </Card>
          </div>
        )}
      </details>

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
        {vendorFilter === undefined ? null : (
          <div className="flex h-10 min-w-0 items-center gap-1 rounded-(--cv-radius) border border-border bg-surface px-2 text-[12px]">
            <span className="shrink-0 text-text-muted">Vendor</span>
            <Link
              to={`/vendors/${vendorFilter}`}
              className="min-w-0 truncate font-medium hover:underline"
            >
              {routeSearch.vendorName ?? "Linked vendor"}
            </Link>
            <Link
              to="/assets"
              search={{}}
              aria-label="Clear vendor filter"
              title="Clear vendor filter"
              className="ml-1 flex size-10 shrink-0 items-center justify-center rounded-(--cv-radius) text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
            >
              <X aria-hidden className="size-3.5" />
            </Link>
          </div>
        )}
        <span className="ml-auto text-[11px] text-text-muted" role="status">
          {assets.isFetching && assets.data !== undefined
            ? "Updating…"
            : `${items.length} asset${items.length === 1 ? "" : "s"}`}
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
          title={
            vendorFilter !== undefined
              ? `No assets linked to ${routeSearch.vendorName ?? "this vendor"}`
              : kindFilter.length > 0
                ? "No assets match this kind"
                : "No assets yet"
          }
          description={
            vendorFilter !== undefined
              ? canWrite(user)
                ? "Create an asset here to link it to this vendor automatically."
                : "No linked assets are available to you. An editor can create or link one."
              : kindFilter.length > 0
                ? "Clear the kind filter to return to every asset."
                : canWrite(user)
                  ? "Create the thing you are researching: a component, device, service, or firmware image."
                  : "No assets are available to you. An editor can create the first asset."
          }
          action={
            vendorFilter !== undefined && canWrite(user) ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus aria-hidden className="size-3.5" />
                  New linked asset
                </Button>
                <Button asChild variant="secondary">
                  <Link to="/assets" search={{}}>
                    Clear vendor filter
                  </Link>
                </Button>
              </div>
            ) : vendorFilter !== undefined ? (
              <Button asChild variant="secondary">
                <Link to="/assets" search={{}}>
                  Clear vendor filter
                </Link>
              </Button>
            ) : kindFilter.length > 0 ? (
              <Button variant="secondary" onClick={() => setKindFilter("")}>
                Clear filter
              </Button>
            ) : canWrite(user) ? (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden className="size-3.5" />
                New asset
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="divide-y divide-border">
            {items.map((asset) => (
              <li key={asset.id}>
                <Link
                  to={`/assets/${asset.id}`}
                  className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[12px] hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus lg:grid-cols-[auto_6rem_minmax(10rem,1fr)_10rem_7rem_minmax(10rem,16rem)_6rem]"
                >
                  <AssetKindIcon kind={asset.kind} />
                  <Mono className="text-text-muted max-lg:col-start-2 max-lg:row-start-2">
                    {asset.ref}
                  </Mono>
                  <span className="min-w-0 truncate font-medium max-lg:col-span-2 max-lg:col-start-2 max-lg:row-start-1">
                    {asset.name}
                  </span>
                  <span className="truncate text-text-muted max-lg:hidden">
                    {asset.vendor?.name ?? asset.legacyVendorName ?? "—"}
                  </span>
                  <span className="truncate text-text-muted max-lg:hidden">
                    {asset.version ?? "—"}
                  </span>
                  <Mono className="truncate text-text-muted max-lg:hidden">
                    {asset.primaryIdentifier ?? ""}
                  </Mono>
                  <span className="shrink-0 text-right text-text-muted max-lg:col-start-3 max-lg:row-start-2">
                    {asset.findingCount} finding
                    {asset.findingCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {assets.data?.nextCursor === null ? null : (
            <div className="flex justify-center border-t border-border p-3">
              <Button
                variant="secondary"
                loading={assets.isFetching}
                onClick={() => setLimit((current) => current + 200)}
              >
                Load more assets
              </Button>
            </div>
          )}
        </div>
      )}

      <CreateAssetDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialVendorId={vendorFilter}
      />
    </div>
  );
}

export function AssetDetailRoute({
  assetId,
}: {
  assetId: string;
}): React.JSX.Element {
  const user = useSession((state) => state.user);
  const [editOpen, setEditOpen] = useState(false);
  const [createFindingOpen, setCreateFindingOpen] = useState(false);
  const [identifierOpen, setIdentifierOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [relationshipOpen, setRelationshipOpen] = useState(false);
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
  const editable = canWrite(user);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={data.name}
        description={`${data.ref} · ${humanise(data.kind)} · ${data.vendor?.name ?? data.legacyVendorName ?? "Vendor unknown"}${data.version === null ? "" : ` · ${data.version}`}`}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link
                to="/findings"
                search={{ assetId: data.id, assetName: data.name }}
              >
                View findings
              </Link>
            </Button>
            {editable ? (
              <>
                <Button variant="secondary" onClick={() => setEditOpen(true)}>
                  <Pencil aria-hidden className="size-3.5" />
                  Edit asset
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setCreateFindingOpen(true)}
                >
                  <FilePlus2 aria-hidden className="size-3.5" />
                  New finding
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Findings</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-text-muted">
                  {metrics.data === undefined
                    ? ""
                    : `${metrics.data.total} against this asset`}
                </span>
                <Button asChild variant="ghost" size="sm">
                  <Link
                    to="/findings"
                    search={{ assetId: data.id, assetName: data.name }}
                  >
                    View findings
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardBody>
              {metrics.error !== null ? (
                <ErrorState
                  title={errorHeading(metrics.error)}
                  description={metrics.error.message}
                  action={
                    <Button
                      variant="secondary"
                      loading={metrics.isFetching}
                      onClick={() => void metrics.refetch()}
                    >
                      Try again
                    </Button>
                  }
                />
              ) : metrics.isLoading ? (
                <LoadingState className="py-2" />
              ) : metrics.data === undefined ? null : metrics.data.total ===
                0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[12px] text-text-muted">
                    No findings are recorded against this asset yet.
                  </p>
                  {editable ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setCreateFindingOpen(true)}
                    >
                      <Plus aria-hidden className="size-3.5" />
                      New finding
                    </Button>
                  ) : null}
                </div>
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
              {editable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIdentifierOpen(true)}
                >
                  <Plus aria-hidden className="size-3.5" />
                  Add identifier
                </Button>
              ) : null}
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
              {editable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setVersionOpen(true)}
                >
                  <Plus aria-hidden className="size-3.5" />
                  Add version
                </Button>
              ) : null}
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
              {editable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRelationshipOpen(true)}
                >
                  <Plus aria-hidden className="size-3.5" />
                  Add relationship
                </Button>
              ) : null}
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

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-1 gap-x-6 gap-y-3 text-[12px] lg:grid-cols-2">
              <DetailItem label="Vendor">
                {data.vendor === null ? (
                  <span className="text-text-muted">
                    {data.legacyVendorName ?? "Not linked"}
                  </span>
                ) : (
                  <Link
                    to={`/vendors/${data.vendor.id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {data.vendor.name}
                  </Link>
                )}
              </DetailItem>
              <DetailItem label="Version or model">
                {data.version ?? "Not recorded"}
              </DetailItem>
              <DetailItem label="Notes" className="lg:col-span-2">
                <span className="whitespace-pre-wrap text-pretty">
                  {data.notes ?? "No notes recorded."}
                </span>
              </DetailItem>
              {Object.keys(data.metadata).length === 0 ? null : (
                <DetailItem label="Metadata" className="lg:col-span-2">
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {Object.entries(data.metadata).map(([key, value]) => (
                      <div
                        key={key}
                        className="grid grid-cols-[9rem_1fr] gap-2"
                      >
                        <dt className="text-text-muted">{humanise(key)}</dt>
                        <dd className="min-w-0 break-words font-mono">
                          {typeof value === "string"
                            ? value
                            : JSON.stringify(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </DetailItem>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
      <EditAssetDialog
        asset={data}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <CreateFindingDialog
        open={createFindingOpen}
        onOpenChange={setCreateFindingOpen}
        assetId={data.id}
      />
      <AddIdentifierDialog
        asset={data}
        open={identifierOpen}
        onOpenChange={setIdentifierOpen}
      />
      <AddVersionDialog
        asset={data}
        open={versionOpen}
        onOpenChange={setVersionOpen}
      />
      <AddRelationshipDialog
        asset={data}
        open={relationshipOpen}
        onOpenChange={setRelationshipOpen}
      />
    </div>
  );
}

function DetailItem({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={className}>
      <p className="mb-1 text-[11px] font-medium text-text-muted">{label}</p>
      <div>{children}</div>
    </div>
  );
}

function AddIdentifierDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: AssetDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [scheme, setScheme] = useState<string>("PURL");
  const [value, setValue] = useState("");
  const [primary, setPrimary] = useState(asset.identifiers.length === 0);
  const add = useApiMutation<AssetDetail>(
    () => ({
      path: `/v1/assets/${asset.id}/identifiers`,
      method: "POST",
      body: { scheme, value: value.trim(), primary },
    }),
    () => [queryKeys.asset(asset.id), queryKeys.assets()],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add asset identifier"
        description="Record the identifier used to match advisories, packages, and prior art."
      >
        <DialogBody className="space-y-3">
          <div>
            <Label>Scheme</Label>
            <Select
              aria-label="Identifier scheme"
              value={scheme}
              onValueChange={setScheme}
              className="mt-1"
              options={ASSET_IDENTIFIER_SCHEMES.map((item) => ({
                value: item,
                label: item,
                description: SCHEME_DESCRIPTIONS[item],
              }))}
            />
          </div>
          <div>
            <Label htmlFor="new-asset-identifier">Identifier</Label>
            <Input
              id="new-asset-identifier"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="pkg:npm/example@1.0.0"
              className="mt-1 font-mono"
              autoFocus
            />
          </div>
          <label className="flex min-h-10 items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={primary}
              onChange={(event) => setPrimary(event.target.checked)}
              className="size-4 accent-accent"
            />
            Use as the primary identifier
          </label>
          {add.error === null ? null : (
            <InlineError>
              {errorHeading(add.error)}. {add.error.message}
            </InlineError>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={add.isPending}
            disabled={value.trim().length === 0}
            onClick={() =>
              add.mutate(undefined, {
                onSuccess: () => {
                  setValue("");
                  setPrimary(false);
                  onOpenChange(false);
                },
              })
            }
          >
            Add identifier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddVersionDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: AssetDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [version, setVersion] = useState("");
  const [releasedAt, setReleasedAt] = useState("");
  const add = useApiMutation<AssetDetail>(
    () => ({
      path: `/v1/assets/${asset.id}/versions`,
      method: "POST",
      body: {
        version: version.trim(),
        ...(releasedAt.length === 0
          ? {}
          : {
              releasedAt: new Date(`${releasedAt}T00:00:00.000Z`).toISOString(),
            }),
      },
    }),
    () => [queryKeys.asset(asset.id), queryKeys.assets()],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add asset version"
        description="Record a release, build, model revision, or firmware version."
      >
        <DialogBody className="space-y-3">
          <div>
            <Label htmlFor="new-asset-version">Version</Label>
            <Input
              id="new-asset-version"
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              placeholder="4.2.1"
              className="mt-1 font-mono"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="new-asset-release-date">
              Release date (optional)
            </Label>
            <Input
              id="new-asset-release-date"
              type="date"
              value={releasedAt}
              onChange={(event) => setReleasedAt(event.target.value)}
              className="mt-1"
            />
          </div>
          {add.error === null ? null : (
            <InlineError>
              {errorHeading(add.error)}. {add.error.message}
            </InlineError>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={add.isPending}
            disabled={version.trim().length === 0}
            onClick={() =>
              add.mutate(undefined, {
                onSuccess: () => {
                  setVersion("");
                  setReleasedAt("");
                  onOpenChange(false);
                },
              })
            }
          >
            Add version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddRelationshipDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: AssetDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [relationship, setRelationship] = useState<string>(
    ASSET_RELATIONSHIPS[0],
  );
  const [toAssetId, setToAssetId] = useState("");
  const [note, setNote] = useState("");
  const candidates = useApiQuery<Paginated<AssetSummary>>(
    queryKeys.assets({ relationshipPicker: asset.id }),
    "/v1/assets?limit=200",
    { enabled: open },
  );
  const options = (candidates.data?.items ?? []).filter(
    (item) => item.id !== asset.id,
  );
  const add = useApiMutation<AssetDetail>(
    () => ({
      path: `/v1/assets/${asset.id}/relationships`,
      method: "POST",
      body: {
        relationship,
        toAssetId,
        ...(note.trim().length === 0 ? {} : { note: note.trim() }),
      },
    }),
    () => [queryKeys.asset(asset.id)],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add asset relationship"
        description={`Describe how ${asset.name} relates to another recorded asset.`}
      >
        <DialogBody className="space-y-3">
          <div>
            <Label>Relationship</Label>
            <Select
              aria-label="Relationship"
              value={relationship}
              onValueChange={setRelationship}
              className="mt-1"
              options={ASSET_RELATIONSHIPS.map((item) => ({
                value: item,
                label: humanise(item),
              }))}
            />
          </div>
          <div>
            <Label>Related asset</Label>
            <Select
              aria-label="Related asset"
              value={toAssetId.length === 0 ? undefined : toAssetId}
              onValueChange={setToAssetId}
              placeholder={
                candidates.isLoading ? "Loading assets…" : "Choose an asset"
              }
              disabled={candidates.isLoading || candidates.error !== null}
              className="mt-1"
              options={options.map((item) => ({
                value: item.id,
                label: item.name,
                description: `${item.ref} · ${humanise(item.kind)}`,
                icon: <AssetKindIcon kind={item.kind} />,
              }))}
            />
          </div>
          {candidates.error === null ? null : (
            <InlineError>
              Assets could not be loaded. {candidates.error.message}
            </InlineError>
          )}
          <div>
            <Label htmlFor="new-asset-relationship-note">Note (optional)</Label>
            <Textarea
              id="new-asset-relationship-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="mt-1"
            />
          </div>
          {add.error === null ? null : (
            <InlineError>
              {errorHeading(add.error)}. {add.error.message}
            </InlineError>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={add.isPending}
            disabled={toAssetId.length === 0}
            onClick={() =>
              add.mutate(undefined, {
                onSuccess: () => {
                  setToAssetId("");
                  setNote("");
                  onOpenChange(false);
                },
              })
            }
          >
            Add relationship
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateAssetDialog({
  open,
  onOpenChange,
  initialVendorId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialVendorId?: string;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssetKind>("SOFTWARE_COMPONENT");
  const [vendorId, setVendorId] = useState<string | null>(
    initialVendorId ?? null,
  );
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [registryOpen, setRegistryOpen] = useState(false);
  const [registryResult, setRegistryResult] =
    useState<AssetRegistryResult | null>(null);
  const [registryMetadata, setRegistryMetadata] = useState<Record<
    string,
    unknown
  > | null>(null);
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
        ...(vendorId === null ? {} : { vendorId }),
        ...(version.trim().length === 0 ? {} : { version: version.trim() }),
        ...(identifier.trim().length === 0
          ? {}
          : { identifier: { scheme, value: identifier.trim() } }),
        ...(notes.trim().length === 0 ? {} : { notes: notes.trim() }),
        ...(registryMetadata === null ? {} : { metadata: registryMetadata }),
      },
    }),
    () => [queryKeys.assets()],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          title="New asset"
          description="Name it and pick a kind. Identifiers, versions and relationships can follow."
        >
          <DialogBody className="space-y-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="asset-name">Name</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setRegistryOpen(true)}
                >
                  <Search aria-hidden className="size-3.5" />
                  Search registries
                </Button>
              </div>
              <Input
                id="asset-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme Router RT-1200"
                autoFocus
                className="mt-1"
              />
              {registryResult === null ? null : (
                <p className="mt-1 text-[11px] text-text-muted" role="status">
                  Prefilled from {registryResult.sourceLabel}. Review every
                  field before creating the asset.
                </p>
              )}
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Vendor (optional)</Label>
                <VendorPicker
                  key={registryResult?.externalId ?? "manual"}
                  value={vendorId}
                  onValueChange={setVendorId}
                  suggestedName={registryResult?.vendorName ?? null}
                  onCreateVendor={() => {
                    onOpenChange(false);
                    setVendorDialogOpen(true);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="asset-version">
                  Version / model (optional)
                </Label>
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
              className="min-h-9 rounded-(--cv-radius) text-[12px] font-medium text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
              onClick={() => setShowAdvanced((current) => !current)}
            >
              {showAdvanced ? "Hide" : "Show"} identifier and notes
            </button>

            {showAdvanced ? (
              <div className="space-y-3 border-t border-border pt-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr]">
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
              disabled={name.trim().length === 0}
              loading={create.isPending}
              onClick={() =>
                create.mutate(undefined, {
                  onSuccess: () => {
                    onOpenChange(false);
                    setName("");
                    setVendorId(initialVendorId ?? null);
                    setVersion("");
                    setIdentifier("");
                    setNotes("");
                    setRegistryResult(null);
                    setRegistryMetadata(null);
                    setShowAdvanced(false);
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
      <RegistrySearchDialog
        open={registryOpen}
        onOpenChange={setRegistryOpen}
        onSelect={(result) => {
          const draft = registryResultToAssetDraft(result);
          setName(draft.name);
          setKind("SOFTWARE_COMPONENT");
          setVersion(draft.version);
          setScheme("PURL");
          setIdentifier(draft.identifier);
          setNotes(draft.notes);
          setRegistryResult(result);
          setRegistryMetadata(draft.metadata);
          setShowAdvanced(true);
          setError(null);
        }}
      />
      <VendorDialog
        key={registryResult?.externalId ?? "manual"}
        open={vendorDialogOpen}
        onOpenChange={(next) => {
          setVendorDialogOpen(next);
          if (!next) onOpenChange(true);
        }}
        onCreated={(created) => {
          setVendorId(created.id);
          setRegistryResult((current) =>
            current === null ? null : { ...current, vendorName: null },
          );
          setVendorDialogOpen(false);
          onOpenChange(true);
        }}
        initialName={registryResult?.vendorName ?? ""}
      />
    </>
  );
}

function EditAssetDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: AssetDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [name, setName] = useState(asset.name);
  const [kind, setKind] = useState<AssetKind>(asset.kind);
  const [vendorId, setVendorId] = useState<string | null>(asset.vendorId);
  const [version, setVersion] = useState(asset.version ?? "");
  const [notes, setNotes] = useState(asset.notes ?? "");
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = useApiMutation<AssetDetail>(
    () => ({
      path: `/v1/assets/${asset.id}`,
      method: "PATCH",
      body: {
        name: name.trim(),
        kind,
        vendorId,
        version: version.trim().length === 0 ? null : version.trim(),
        notes: notes.trim().length === 0 ? null : notes.trim(),
        expectedRevision: asset.revision,
      },
    }),
    () => [queryKeys.asset(asset.id), queryKeys.assets()],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          title="Edit asset"
          description="Vendor linkage uses a directory ID. Disclosure routes are chosen later for each submission."
        >
          <DialogBody className="space-y-3">
            <div>
              <Label htmlFor="edit-asset-name">Name</Label>
              <Input
                id="edit-asset-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Kind</Label>
                <Select
                  aria-label="Edit asset kind"
                  value={kind}
                  onValueChange={(value) => setKind(value as AssetKind)}
                  options={assetKindSelectOptions(ASSET_KINDS)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="edit-asset-version">Version / model</Label>
                <Input
                  id="edit-asset-version"
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label>Vendor</Label>
              <VendorPicker
                value={vendorId}
                onValueChange={setVendorId}
                onCreateVendor={() => {
                  onOpenChange(false);
                  setVendorDialogOpen(true);
                }}
              />
              {asset.legacyVendorName === null ? null : (
                <p className="mt-1 text-[10px] text-text-muted">
                  Imported legacy label: {asset.legacyVendorName}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="edit-asset-notes">Notes</Label>
              <Textarea
                id="edit-asset-notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="mt-1"
              />
            </div>
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
              disabled={name.trim().length === 0}
              loading={update.isPending}
              onClick={() =>
                update.mutate(undefined, {
                  onSuccess: () => onOpenChange(false),
                  onError: (mutationError) => setError(mutationError.message),
                })
              }
            >
              Save asset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <VendorDialog
        open={vendorDialogOpen}
        onOpenChange={(next) => {
          setVendorDialogOpen(next);
          if (!next) onOpenChange(true);
        }}
        onCreated={(created) => {
          setVendorId(created.id);
          setVendorDialogOpen(false);
          onOpenChange(true);
        }}
      />
    </>
  );
}

export { ASSET_RELATIONSHIPS };
