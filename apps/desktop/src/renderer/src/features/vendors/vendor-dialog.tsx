import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import type { VendorDetail, VendorSummary } from "@codevault/contracts";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Input,
  Label,
} from "@codevault/ui";

import { queryKeys, useApiMutation, useApiQuery } from "../../lib/api.js";

interface PaginatedVendors {
  items: VendorSummary[];
  nextCursor: string | null;
}

export function VendorPicker({
  value,
  onValueChange,
  onCreateVendor,
  disabled = false,
}: {
  value: string | null;
  onValueChange: (vendorId: string | null) => void;
  onCreateVendor?: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const vendors = useApiQuery<PaginatedVendors>(
    queryKeys.vendors(),
    "/v1/vendors?limit=200",
  );
  const options = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-US");

    return (vendors.data?.items ?? []).filter(
      (vendor) =>
        needle.length === 0 ||
        vendor.name.toLocaleLowerCase("en-US").includes(needle) ||
        vendor.ref.toLocaleLowerCase("en-US").includes(needle),
    );
  }, [query, vendors.data?.items]);

  return (
    <div className="space-y-1">
      <Input
        aria-label="Search vendors"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by vendor name or reference"
        disabled={disabled}
      />
      <div className="flex gap-1">
        <select
          aria-label="Vendor"
          className="h-7 min-w-0 flex-1 rounded-(--cv-radius) border border-border bg-surface px-2 text-[13px] focus-visible:border-focus focus-visible:outline-none disabled:opacity-60"
          value={value ?? ""}
          onChange={(event) =>
            onValueChange(
              event.target.value.length === 0 ? null : event.target.value,
            )
          }
          disabled={disabled || vendors.isLoading}
        >
          <option value="">No vendor selected</option>
          {options.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name}
            </option>
          ))}
        </select>
        {onCreateVendor === undefined ? null : (
          <Button size="sm" onClick={onCreateVendor} disabled={disabled}>
            <Plus aria-hidden className="size-3.5" />
            Create vendor
          </Button>
        )}
      </div>
      {vendors.error === null ? null : (
        <p className="text-[11px] text-danger">{vendors.error.message}</p>
      )}
    </div>
  );
}

export function VendorDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (vendor: VendorDetail) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useApiMutation<VendorDetail>(
    () => ({
      path: "/v1/vendors",
      body: {
        name: name.trim(),
        ...(websiteUrl.trim().length === 0
          ? {}
          : { websiteUrl: websiteUrl.trim() }),
        ...(sourceUrl.trim().length === 0
          ? {}
          : {
              sourceUrl: sourceUrl.trim(),
              sourceReviewedAt: new Date().toISOString(),
            }),
      },
    }),
    (vendor) => [queryKeys.vendors(), queryKeys.vendor(vendor.id)],
  );

  const close = (): void => {
    onOpenChange(false);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Create vendor"
        description="Add the organization responsible for receiving a disclosure. Routes and independently verified keys are added afterwards."
      >
        <DialogBody className="space-y-3">
          <div>
            <Label htmlFor="vendor-name">Name</Label>
            <Input
              id="vendor-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="vendor-website">Website (HTTPS, optional)</Label>
            <Input
              id="vendor-website"
              type="url"
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              placeholder="https://vendor.example/"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="vendor-source">
              Official security source (HTTPS, optional)
            </Label>
            <Input
              id="vendor-source"
              type="url"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://vendor.example/security"
              className="mt-1"
            />
          </div>
          {error === null ? null : (
            <p className="text-[12px] text-danger">{error}</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={name.trim().length === 0}
            loading={create.isPending}
            onClick={() =>
              create.mutate(undefined, {
                onSuccess: (vendor) => {
                  setName("");
                  setWebsiteUrl("");
                  setSourceUrl("");
                  close();
                  onCreated?.(vendor);
                },
                onError: (mutationError) => setError(mutationError.message),
              })
            }
          >
            Create vendor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
