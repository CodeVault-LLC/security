import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { VendorDetail } from "@codevault/contracts";

import { PublicKeyPanel } from "./public-key-panel.js";
import { VendorPicker } from "./vendor-dialog.js";

const VENDOR_ID = "018f2f56-7c9a-7abc-8def-0123456789ab";
const KEY_ID = "018f2f56-7c9a-7abc-8def-0123456789ac";
const FINGERPRINT = "0123456789ABCDEF0123456789ABCDEF01234567";

const VENDOR: VendorDetail = {
  id: VENDOR_ID,
  ref: "VND-000001",
  slug: "example-psirt",
  name: "Example PSIRT",
  websiteUrl: "https://example.com/",
  builtIn: false,
  sourceUrl: "https://example.com/security",
  sourceReviewedAt: "2026-08-18T00:00:00.000Z",
  archivedAt: null,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
  revision: 1,
  assetCount: 0,
  routes: [],
  publicKeys: [
    {
      id: KEY_ID,
      vendorId: VENDOR_ID,
      armoredKey: "-----BEGIN PGP PUBLIC KEY BLOCK-----",
      fingerprint: FINGERPRINT,
      userIds: ["Example PSIRT <security@example.com>"],
      algorithm: "eddsaLegacy/ed25519Legacy",
      createdAt: "2026-08-18T00:00:00.000Z",
      expiresAt: null,
      revokedAt: null,
      verifiedBy: null,
      verifiedAt: null,
      sourceUrl: "https://example.com/security/key.asc",
      supersededById: null,
      revision: 1,
    },
  ],
};

function renderWithApi(
  component: React.ReactNode,
  request: (path: string, options?: unknown) => Promise<unknown>,
) {
  Object.defineProperty(window, "codevault", {
    configurable: true,
    value: { api: { request: vi.fn(request) } },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>{component}</QueryClientProvider>,
  );
}

describe("vendor trust UI", () => {
  it("does not offer a key-selection action without a selection handler", async () => {
    renderWithApi(<PublicKeyPanel vendorId={VENDOR_ID} />, async () => ({
      ok: true,
      data: VENDOR,
    }));

    expect(await screen.findByText("Not verified")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Use for encryption" }),
    ).toBeNull();
    expect(
      screen.getByText("0123 4567 89AB CDEF 0123 4567 89AB CDEF 0123 4567"),
    ).toBeTruthy();
  });

  it("requires the final fingerprint group before verification", async () => {
    const user = userEvent.setup();
    renderWithApi(<PublicKeyPanel vendorId={VENDOR_ID} />, async () => ({
      ok: true,
      data: VENDOR,
    }));

    const verify = await screen.findByRole("button", {
      name: "Verify fingerprint",
    });
    expect(verify).toHaveProperty("disabled", true);
    await user.type(
      screen.getByLabelText("Last eight fingerprint characters"),
      "01234567",
    );
    expect(verify).toHaveProperty("disabled", false);
  });

  it("returns a vendor ID from the asset picker instead of free text", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithApi(
      <VendorPicker value={null} onValueChange={onValueChange} />,
      async () => ({
        ok: true,
        data: { items: [VENDOR], nextCursor: null },
      }),
    );

    await screen.findByRole("option", { name: "Example PSIRT" });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Vendor" }),
      VENDOR_ID,
    );
    expect(onValueChange).toHaveBeenCalledWith(VENDOR_ID);
  });
});
