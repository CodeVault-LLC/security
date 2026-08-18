import { useState } from "react";

import type {
  SubmissionDetail,
  VendorDetail,
  VendorSummary,
} from "@codevault/contracts";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Label,
} from "@codevault/ui";

import { queryKeys, useApiMutation, useApiQuery } from "../../lib/api.js";

export function CreateSubmissionDialog({
  caseId,
  open,
  onOpenChange,
  onCreated,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (submission: SubmissionDetail) => void;
}): React.JSX.Element {
  const [vendorId, setVendorId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const vendors = useApiQuery<{ items: VendorSummary[] }>(
    queryKeys.vendors({ active: true }),
    "/v1/vendors?limit=200",
  );
  const vendor = useApiQuery<VendorDetail>(
    queryKeys.vendor(vendorId),
    `/v1/vendors/${vendorId}`,
    { enabled: vendorId.length > 0 },
  );
  const selectedRoute = vendor.data?.routes.find(
    (route) => route.id === routeId,
  );
  const create = useApiMutation<SubmissionDetail, void>(
    () => ({
      path: `/v1/cases/${caseId}/submissions`,
      body: {
        vendorId,
        routeId,
        cryptoMode:
          selectedRoute?.type === "EMAIL" &&
          selectedRoute.encryptionPolicy === "REQUIRED"
            ? "ENCRYPTED"
            : "PLAIN",
      },
    }),
    (submission) => [
      queryKeys.submissions(caseId),
      queryKeys.submission(submission.id),
    ],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Prepare vendor submission">
        <DialogBody className="space-y-3">
          <p className="text-[12px] text-warning">
            Vendor suggestions are based on case assets. Confirm the current
            route against the vendor’s official security policy before
            disclosure.
          </p>
          <div>
            <Label htmlFor="submission-vendor">Vendor</Label>
            <select
              id="submission-vendor"
              className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-[12px]"
              value={vendorId}
              onChange={(event) => {
                setVendorId(event.target.value);
                setRouteId("");
              }}
            >
              <option value="">Select a directory vendor</option>
              {(vendors.data?.items ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="submission-route">Active route</Label>
            <select
              id="submission-route"
              className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-[12px]"
              value={routeId}
              disabled={vendorId.length === 0}
              onChange={(event) => setRouteId(event.target.value)}
            >
              <option value="">Select a route</option>
              {(vendor.data?.routes ?? [])
                .filter((route) => route.active)
                .map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name} · {route.type.toLowerCase()}
                  </option>
                ))}
            </select>
          </div>
          {selectedRoute?.sourceUrl ? (
            <p className="break-all text-[11px] text-text-muted">
              Source: {selectedRoute.sourceUrl}
            </p>
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
            disabled={selectedRoute === undefined}
            loading={create.isPending}
            onClick={() =>
              create.mutate(undefined, {
                onSuccess: onCreated,
                onError: (mutationError) => setError(mutationError.message),
              })
            }
          >
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
