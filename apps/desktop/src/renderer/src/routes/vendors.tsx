import { Link } from "@tanstack/react-router";
import {
  KeyRound,
  Mail,
  Plus,
  Route as RouteIcon,
  SquareArrowOutUpRight,
} from "lucide-react";
import { useState } from "react";

import type {
  AssetSummary,
  VendorDetail,
  VendorRoute,
  VendorSummary,
} from "@codevault/contracts";
import {
  Button,
  AssetKindIcon,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  InlineError,
  LoadingState,
  Mono,
} from "@codevault/ui";

import { PageHeader } from "../components/app-shell.js";
import { PublicKeyPanel } from "../features/vendors/public-key-panel.js";
import { RouteEditor } from "../features/vendors/route-editor.js";
import { VendorDialog } from "../features/vendors/vendor-dialog.js";
import { useDebouncedValue } from "../hooks/use-debounced-value.js";
import { errorHeading, queryKeys, useApiQuery } from "../lib/api.js";
import { formatDate } from "../lib/dates.js";
import { humanise } from "../lib/format.js";
import { canWrite, useSession } from "../lib/session.js";

interface VendorPage {
  items: VendorSummary[];
  nextCursor: string | null;
}

interface AssetPage {
  items: AssetSummary[];
  nextCursor: string | null;
}

export function VendorsRoute(): React.JSX.Element {
  const user = useSession((state) => state.user);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [limit, setLimit] = useState(200);
  const debouncedQuery = useDebouncedValue(query, 220);
  const vendors = useApiQuery<VendorPage>(
    queryKeys.vendors({ query: debouncedQuery, limit }),
    `/v1/vendors?limit=${limit}${debouncedQuery.trim().length === 0 ? "" : `&query=${encodeURIComponent(debouncedQuery.trim())}`}`,
  );
  const editable = canWrite(user);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Vendors"
        description="Organizations, disclosure routes, response expectations, and independently verified public keys."
        actions={
          editable ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden className="size-3.5" />
              New vendor
            </Button>
          ) : undefined
        }
      />
      <div className="flex items-center gap-3 border-b border-border p-3">
        <Input
          aria-label="Search vendors"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or reference"
          className="max-w-md"
        />
        <span className="ml-auto text-[11px] text-text-muted" role="status">
          {vendors.isFetching && vendors.data !== undefined
            ? "Updating…"
            : `${vendors.data?.items.length ?? 0} vendor${vendors.data?.items.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {vendors.isLoading ? (
        <LoadingState label="Loading vendors…" />
      ) : vendors.error !== null ? (
        <ErrorState
          title={errorHeading(vendors.error)}
          description={vendors.error.message}
          action={
            <Button
              variant="secondary"
              loading={vendors.isFetching}
              onClick={() => void vendors.refetch()}
            >
              Try again
            </Button>
          }
        />
      ) : (vendors.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title={
            query.trim().length > 0 ? "No vendors match" : "No vendors yet"
          }
          description={
            query.trim().length > 0
              ? "Clear the search to return to the full vendor directory."
              : editable
                ? "Add a vendor before creating a disclosure route."
                : "No vendors are available to you. An editor can add the first vendor."
          }
          action={
            query.trim().length > 0 ? (
              <Button variant="secondary" onClick={() => setQuery("")}>
                Clear search
              </Button>
            ) : editable ? (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden className="size-3.5" />
                New vendor
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="divide-y divide-border">
            {vendors.data?.items.map((vendor) => (
              <li key={vendor.id}>
                <Link
                  to={`/vendors/${vendor.id}`}
                  className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus lg:grid-cols-[8rem_minmax(12rem,1fr)_auto_10rem]"
                >
                  <Mono className="text-[11px] text-text-muted max-lg:row-start-2">
                    {vendor.ref}
                  </Mono>
                  <span className="min-w-0 truncate text-[13px] font-medium max-lg:col-span-2 max-lg:row-start-1">
                    {vendor.name}
                  </span>
                  {vendor.builtIn ? (
                    <span className="text-[11px] text-warning">
                      Verify before use
                    </span>
                  ) : null}
                  <span className="shrink-0 text-right text-[11px] text-text-muted">
                    Reviewed {formatDate(vendor.sourceReviewedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {vendors.data?.nextCursor === null ? null : (
            <div className="flex justify-center border-t border-border p-3">
              <Button
                variant="secondary"
                loading={vendors.isFetching}
                onClick={() => setLimit((current) => current + 200)}
              >
                Load more vendors
              </Button>
            </div>
          )}
        </div>
      )}
      <VendorDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

export function VendorDetailRoute({
  vendorId,
}: {
  vendorId: string;
}): React.JSX.Element {
  const user = useSession((state) => state.user);
  const vendor = useApiQuery<VendorDetail>(
    queryKeys.vendor(vendorId),
    `/v1/vendors/${vendorId}`,
  );
  const linkedAssets = useApiQuery<AssetPage>(
    queryKeys.assets({ vendorId, preview: true }),
    `/v1/assets?vendorId=${encodeURIComponent(vendorId)}&limit=5`,
  );
  const [routeEditorOpen, setRouteEditorOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<VendorRoute | undefined>();

  if (vendor.isLoading) return <LoadingState label="Loading vendor…" />;
  if (vendor.error !== null || vendor.data === undefined) {
    return (
      <ErrorState
        title={errorHeading(vendor.error)}
        description={
          vendor.error?.message ?? "That vendor could not be loaded."
        }
        action={
          <Button
            variant="secondary"
            loading={vendor.isFetching}
            onClick={() => void vendor.refetch()}
          >
            Try again
          </Button>
        }
      />
    );
  }
  const data = vendor.data;
  const editable = canWrite(user);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={data.name}
        description={`${data.ref} · ${data.assetCount} linked asset${data.assetCount === 1 ? "" : "s"}`}
        actions={
          editable ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditingRoute(undefined);
                setRouteEditorOpen(true);
              }}
            >
              <Plus aria-hidden className="size-3.5" />
              Add disclosure route
            </Button>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {data.builtIn ? (
          <div className="mb-4 rounded-(--cv-radius) border border-warning/40 bg-warning/10 p-3 text-[12px] text-warning">
            <strong>Starter data — verify before use.</strong> Confirm the
            recipient, portal requirements, current limits, and any encryption
            fingerprint against the official source before a confidential
            disclosure.
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Identity</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2 text-[12px]">
              <IdentityRow label="Stable ID" value={data.slug} mono />
              <IdentityRow label="Website" value={data.websiteUrl} link />
              <IdentityRow
                label="Official source"
                value={data.sourceUrl}
                link
              />
              <IdentityRow
                label="Source reviewed"
                value={formatDate(data.sourceReviewedAt)}
              />
              <IdentityRow
                label="Status"
                value={
                  data.archivedAt === null
                    ? "Active"
                    : `Archived ${formatDate(data.archivedAt)}`
                }
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Linked assets</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link
                  to="/assets"
                  search={{ vendorId: data.id, vendorName: data.name }}
                >
                  View all
                </Link>
              </Button>
            </CardHeader>
            {linkedAssets.error !== null ? (
              <CardBody className="space-y-2">
                <InlineError>
                  Linked assets could not be loaded.{" "}
                  {linkedAssets.error.message}
                </InlineError>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={linkedAssets.isFetching}
                  onClick={() => void linkedAssets.refetch()}
                >
                  Try again
                </Button>
              </CardBody>
            ) : linkedAssets.isLoading ? (
              <LoadingState label="Loading linked assets…" className="py-4" />
            ) : (linkedAssets.data?.items.length ?? 0) === 0 ? (
              <CardBody className="space-y-3">
                <p className="text-[12px] text-text-muted">
                  No assets currently point to this vendor.
                </p>
                {editable ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link
                      to="/assets"
                      search={{
                        vendorId: data.id,
                        vendorName: data.name,
                        create: true,
                      }}
                    >
                      <Plus aria-hidden className="size-3.5" />
                      New linked asset
                    </Link>
                  </Button>
                ) : null}
              </CardBody>
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {linkedAssets.data?.items.map((asset) => (
                    <li key={asset.id}>
                      <Link
                        to={`/assets/${asset.id}`}
                        className="grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-2 text-[12px] hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
                      >
                        <AssetKindIcon kind={asset.kind} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {asset.name}
                          </span>
                          <Mono className="text-[10.5px] text-text-muted">
                            {asset.ref}
                          </Mono>
                        </span>
                        <span className="text-[11px] text-text-muted">
                          {asset.findingCount} finding
                          {asset.findingCount === 1 ? "" : "s"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <CardBody className="border-t border-border py-2 text-[11px] text-text-muted">
                  Showing {linkedAssets.data?.items.length ?? 0} of{" "}
                  {data.assetCount} linked asset
                  {data.assetCount === 1 ? "" : "s"}. Disclosure routes are
                  selected per submission, not on the asset.
                </CardBody>
              </>
            )}
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Disclosure routes</CardTitle>
            </CardHeader>
            {data.routes.length === 0 ? (
              <EmptyState
                title="No disclosure routes recorded"
                description={
                  editable
                    ? "Add the official email or manual portal used for coordinated disclosure."
                    : "A workspace editor must add and verify the vendor's disclosure route."
                }
                action={
                  editable ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingRoute(undefined);
                        setRouteEditorOpen(true);
                      }}
                    >
                      <Plus aria-hidden className="size-3.5" />
                      Add disclosure route
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="divide-y divide-border">
                {data.routes.map((route) => (
                  <RouteRecord
                    key={route.id}
                    route={route}
                    editable={editable}
                    onEdit={() => {
                      setEditingRoute(route);
                      setRouteEditorOpen(true);
                    }}
                  />
                ))}
              </div>
            )}
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Public keys</CardTitle>
              <KeyRound aria-hidden className="size-4 text-text-muted" />
            </CardHeader>
            <CardBody>
              <PublicKeyPanel vendorId={data.id} canEdit={editable} />
            </CardBody>
          </Card>
        </div>
      </div>
      <RouteEditor
        key={`${editingRoute?.id ?? "new"}-${String(routeEditorOpen)}`}
        vendor={data}
        {...(editingRoute === undefined ? {} : { route: editingRoute })}
        open={routeEditorOpen}
        onOpenChange={setRouteEditorOpen}
      />
    </div>
  );
}

function IdentityRow({
  label,
  value,
  link = false,
  mono = false,
}: {
  label: string;
  value: string | null;
  link?: boolean;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2">
      <span className="text-text-muted">{label}</span>
      {value === null ? (
        <span>—</span>
      ) : link ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 break-all text-accent hover:underline"
        >
          {value}
          <SquareArrowOutUpRight aria-hidden className="size-3 shrink-0" />
        </a>
      ) : mono ? (
        <Mono>{value}</Mono>
      ) : (
        <span>{value}</span>
      )}
    </div>
  );
}

function RouteRecord({
  route,
  editable,
  onEdit,
}: {
  route: VendorRoute;
  editable: boolean;
  onEdit: () => void;
}): React.JSX.Element {
  return (
    <div className="p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {route.type === "EMAIL" ? (
          <Mail aria-hidden className="size-4 text-text-muted" />
        ) : (
          <RouteIcon aria-hidden className="size-4 text-text-muted" />
        )}
        <strong>{route.name}</strong>
        <span className={route.active ? "text-success" : "text-warning"}>
          {route.active ? "Active" : "Disabled — retained for history"}
        </span>
        <span className="w-full text-[11px] text-text-muted lg:ml-auto lg:w-auto">
          Ack {route.acknowledgementBusinessDays} business days
          {route.updateCadenceDays === null
            ? ""
            : ` · updates every ${route.updateCadenceDays} days`}
        </span>
        {editable ? (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
      </div>
      {route.type === "EMAIL" ? (
        <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-[120px_1fr]">
          <span className="text-text-muted">Recipients</span>
          <span>
            {route.to.join(", ")}
            {route.cc.length === 0 ? "" : ` · CC ${route.cc.join(", ")}`}
          </span>
          <span className="text-text-muted">Encryption</span>
          <span>
            {humanise(route.encryptionPolicy)}
            {route.publicKeyId === null
              ? " · no key selected"
              : " · verified key selected"}
          </span>
          <span className="text-text-muted">Subject</span>
          <Mono>{route.subjectTemplate}</Mono>
        </div>
      ) : (
        <div className="mt-2 text-[11px]">
          <a
            href={route.destinationUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            {route.destinationUrl}
          </a>
          <p className="mt-1 text-text-muted">
            {route.fieldMappings.length} ordered portal fields · prepare and
            download only; portal submission remains manual.
          </p>
        </div>
      )}
      {route.sourceUrl === null ? null : (
        <p className="mt-2 text-[10px] text-text-muted">
          Source reviewed {formatDate(route.sourceReviewedAt ?? null)} ·{" "}
          {route.sourceUrl}
        </p>
      )}
    </div>
  );
}
