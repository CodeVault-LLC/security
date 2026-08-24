import { Database, Search } from "lucide-react";
import { useState } from "react";

import type {
  AssetRegistryResult,
  AssetRegistrySearchResponse,
  AssetRegistrySource,
} from "@codevault/contracts";
import { ASSET_REGISTRY_SOURCES } from "@codevault/contracts";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  EmptyState,
  ErrorState,
  InlineError,
  Input,
  Label,
  LoadingState,
  Mono,
  Select,
} from "@codevault/ui";

import { useDebouncedValue } from "../../hooks/use-debounced-value.js";
import { errorHeading, queryKeys, useApiQuery } from "../../lib/api.js";

const SOURCE_LABELS: Record<AssetRegistrySource, string> = {
  WORDPRESS_PLUGIN: "WordPress plugins",
  WORDPRESS_THEME: "WordPress themes",
  NPM: "npm",
  CRATES_IO: "crates.io",
  PACKAGIST: "Packagist",
  RUBYGEMS: "RubyGems",
  NUGET: "NuGet",
  MAVEN_CENTRAL: "Maven Central",
};

export interface RegistryAssetDraft {
  name: string;
  version: string;
  identifier: string;
  notes: string;
  vendorName: string | null;
  metadata: Record<string, unknown>;
}

export function registryResultToAssetDraft(
  result: AssetRegistryResult,
): RegistryAssetDraft {
  return {
    name: result.name,
    version: result.latestVersion ?? "",
    identifier: result.purl,
    notes: result.description ?? "",
    vendorName: result.vendorName,
    metadata: {
      ...result.metadata,
      registrySource: result.source,
      registryExternalId: result.externalId,
      registrySourceUrl: result.sourceUrl,
      registryHomepageUrl: result.homepageUrl,
      registryLastUpdatedAt: result.lastUpdatedAt,
    },
  };
}

export function RegistrySearchDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (result: AssetRegistryResult) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<AssetRegistrySource | "ALL">("ALL");
  const debouncedQuery = useDebouncedValue(query.trim(), 350);
  const canSearch = open && debouncedQuery.length >= 2;
  const parameters = new URLSearchParams({
    query: debouncedQuery,
    limit: "30",
  });
  if (source !== "ALL") parameters.set("source", source);

  const search = useApiQuery<AssetRegistrySearchResponse>(
    queryKeys.assetRegistry(debouncedQuery, source),
    `/v1/asset-registries/search?${parameters.toString()}`,
    { enabled: canSearch },
  );

  const items = search.data?.items ?? [];
  const failures = search.data?.failures ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width="max-w-3xl"
        title="Search package registries"
        description="Pick a catalog record to fill the asset form. Review it before creating the asset."
      >
        <DialogBody className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_13rem]">
            <div>
              <Label htmlFor="registry-query">Package or extension</Label>
              <div className="relative mt-1">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted"
                />
                <Input
                  id="registry-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by package name"
                  className="pl-9"
                  autoFocus
                />
              </div>
            </div>
            <div>
              <Label>Registry</Label>
              <Select
                aria-label="Registry"
                className="mt-1"
                value={source}
                onValueChange={(value) =>
                  setSource(value as AssetRegistrySource | "ALL")
                }
                options={[
                  { value: "ALL", label: "All registries" },
                  ...ASSET_REGISTRY_SOURCES.map((value) => ({
                    value,
                    label: SOURCE_LABELS[value],
                  })),
                ]}
              />
            </div>
          </div>

          {failures.length === 0 ? null : (
            <InlineError>
              {failures.length}{" "}
              {failures.length === 1 ? "registry is" : "registries are"}
              {" unavailable. Results from the other registries are shown: "}
              {failures.map((failure) => failure.sourceLabel).join(", ")}.
            </InlineError>
          )}

          {query.trim().length < 2 ? (
            <EmptyState
              title="Enter at least two characters"
              description="Search WordPress extensions and public package catalogs without leaving the asset form."
            />
          ) : search.isLoading ? (
            <LoadingState label="Searching registries…" />
          ) : search.error !== null ? (
            <ErrorState
              title={errorHeading(search.error)}
              description={`${search.error.message} Check the connection, then try again.`}
              action={
                <Button
                  size="sm"
                  loading={search.isFetching}
                  onClick={() => void search.refetch()}
                >
                  Try again
                </Button>
              }
            />
          ) : canSearch && search.data !== undefined && items.length === 0 ? (
            <EmptyState
              title="No matching packages"
              description="Try a broader name or choose a different registry."
            />
          ) : (
            <div>
              <p className="mb-1 text-[11px] text-text-muted" role="status">
                {items.length} {items.length === 1 ? "result" : "results"}
              </p>
              <ul className="max-h-[44vh] divide-y divide-border overflow-y-auto border-y border-border">
                {items.map((item) => (
                  <li key={`${item.source}:${item.externalId}`}>
                    <button
                      type="button"
                      className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-2 py-2 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
                      onClick={() => {
                        onSelect(item);
                        onOpenChange(false);
                      }}
                    >
                      <span className="min-w-0">
                        <span
                          className="block truncate text-[13px] font-medium"
                          title={item.name}
                        >
                          {item.name}
                        </span>
                        {item.description === null ? null : (
                          <span className="mt-0.5 line-clamp-2 [overflow-wrap:anywhere] text-[11px] leading-4 text-text-muted">
                            {item.description}
                          </span>
                        )}
                      </span>
                      <span className="rounded-(--cv-radius) bg-surface-raised px-2 py-0.5 text-[10px] font-medium text-text-muted">
                        {item.sourceLabel}
                      </span>
                      <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
                        <Mono
                          className="max-w-full truncate text-[10px]"
                          title={item.purl}
                        >
                          {item.purl}
                        </Mono>
                        {item.latestVersion === null ? null : (
                          <span className="tabular-nums">
                            v{item.latestVersion}
                          </span>
                        )}
                        {item.vendorName === null ? null : (
                          <span className="truncate">by {item.vendorName}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DialogBody>
        <DialogFooter className="justify-between">
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Database aria-hidden className="size-3.5" />
            External data stays a proposal until you create the asset.
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
