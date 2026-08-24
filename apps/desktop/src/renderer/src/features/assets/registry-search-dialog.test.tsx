import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AssetRegistryResult } from "@codevault/contracts";

import {
  RegistrySearchDialog,
  registryResultToAssetDraft,
} from "./registry-search-dialog.js";

const RESULT: AssetRegistryResult = {
  source: "WORDPRESS_PLUGIN",
  sourceLabel: "WordPress plugins",
  externalId: "secure-plugin",
  name: "Secure Plugin",
  description: "Blocks unsafe input.",
  latestVersion: "2.1.0",
  purl: "pkg:wordpress/secure-plugin",
  vendorName: "Acme Security",
  homepageUrl: "https://example.com/plugin",
  sourceUrl: "https://wordpress.org/plugins/secure-plugin/",
  lastUpdatedAt: "2026-08-20T12:00:00.000Z",
  metadata: { activeInstalls: 12_000 },
};

function renderWithApi(component: React.ReactNode) {
  Object.defineProperty(window, "codevault", {
    configurable: true,
    value: {
      api: {
        request: vi.fn(async () => ({
          ok: true,
          data: {
            items: [RESULT],
            failures: [],
            searchedSources: ["WORDPRESS_PLUGIN"],
          },
        })),
      },
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{component}</QueryClientProvider>,
  );
}

describe("registry asset proposals", () => {
  it("maps registry data to reviewable asset fields and provenance", () => {
    expect(registryResultToAssetDraft(RESULT)).toEqual({
      name: "Secure Plugin",
      version: "2.1.0",
      identifier: "pkg:wordpress/secure-plugin",
      notes: "Blocks unsafe input.",
      vendorName: "Acme Security",
      metadata: {
        activeInstalls: 12_000,
        registrySource: "WORDPRESS_PLUGIN",
        registryExternalId: "secure-plugin",
        registrySourceUrl: "https://wordpress.org/plugins/secure-plugin/",
        registryHomepageUrl: "https://example.com/plugin",
        registryLastUpdatedAt: "2026-08-20T12:00:00.000Z",
      },
    });
  });

  it("debounces search and returns the selected proposal", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithApi(
      <RegistrySearchDialog
        open
        onOpenChange={() => undefined}
        onSelect={onSelect}
      />,
    );

    await user.type(screen.getByLabelText("Package or extension"), "secure");
    await user.click(
      await screen.findByRole("button", { name: /Secure Plugin/ }),
    );

    expect(onSelect).toHaveBeenCalledWith(RESULT);
  });
});
