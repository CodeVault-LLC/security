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
  VendorDetail,
  VendorRoute,
  VendorSummary,
} from "@codevault/contracts";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Mono,
} from "@codevault/ui";

import { PageHeader } from "../components/app-shell.js";
import { PublicKeyPanel } from "../features/vendors/public-key-panel.js";
import { RouteEditor } from "../features/vendors/route-editor.js";
import { VendorDialog } from "../features/vendors/vendor-dialog.js";
import { errorHeading, queryKeys, useApiQuery } from "../lib/api.js";
import { formatDate } from "../lib/dates.js";
import { humanise } from "../lib/format.js";
import { canWrite, useSession } from "../lib/session.js";

interface VendorPage {
  items: VendorSummary[];
  nextCursor: string | null;
}

export function VendorsRoute(): React.JSX.Element {
  const user = useSession((state) => state.user);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const vendors = useApiQuery<VendorPage>(
    queryKeys.vendors({ query }),
    `/v1/vendors?limit=200${query.trim().length === 0 ? "" : `&query=${encodeURIComponent(query.trim())}`}`,
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Vendors"
        description="Organizations, disclosure routes, response expectations, and independently verified public keys."
        actions={
          canWrite(user) ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden className="size-3.5" />
              New vendor
            </Button>
          ) : undefined
        }
      />
      <div className="border-b border-border p-3">
        <Input
          aria-label="Search vendors"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or reference"
          className="max-w-md"
        />
      </div>
      {vendors.isLoading ? (
        <LoadingState label="Loading vendors…" />
      ) : vendors.error !== null ? (
        <ErrorState
          title={errorHeading(vendors.error)}
          description={vendors.error.message}
        />
      ) : (vendors.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No vendors found"
          description="Add a vendor before creating a disclosure route."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="divide-y divide-border">
            {vendors.data?.items.map((vendor) => (
              <li key={vendor.id}>
                <Link
                  to={`/vendors/${vendor.id}`}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-surface-hover"
                >
                  <Mono className="w-24 shrink-0 text-[11px] text-text-muted">
                    {vendor.ref}
                  </Mono>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {vendor.name}
                  </span>
                  {vendor.builtIn ? (
                    <span className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
                      Starter data — verify before use
                    </span>
                  ) : null}
                  <span className="w-36 shrink-0 text-right text-[11px] text-text-muted">
                    Reviewed {formatDate(vendor.sourceReviewedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
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
              <CardTitle>Assets</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-[13px]">
                {data.assetCount} linked asset{data.assetCount === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-[11px] text-text-muted">
                Assets point to this vendor by immutable ID. A route is selected
                when preparing each submission, not permanently on the asset.
              </p>
              <Button asChild size="sm" className="mt-3">
                <Link to="/assets">View assets</Link>
              </Button>
            </CardBody>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Disclosure routes</CardTitle>
              {editable ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingRoute(undefined);
                    setRouteEditorOpen(true);
                  }}
                >
                  <Plus aria-hidden className="size-3.5" />
                  Add route
                </Button>
              ) : null}
            </CardHeader>
            {data.routes.length === 0 ? (
              <CardBody className="text-[12px] text-text-muted">
                No disclosure routes recorded.
              </CardBody>
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
      <div className="flex items-center gap-2">
        {route.type === "EMAIL" ? (
          <Mail aria-hidden className="size-4 text-text-muted" />
        ) : (
          <RouteIcon aria-hidden className="size-4 text-text-muted" />
        )}
        <strong>{route.name}</strong>
        <span className={route.active ? "text-success" : "text-warning"}>
          {route.active ? "Active" : "Disabled — retained for history"}
        </span>
        <span className="ml-auto text-[11px] text-text-muted">
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
        <div className="mt-2 grid grid-cols-[120px_1fr] gap-1 text-[11px]">
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
