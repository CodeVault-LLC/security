import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FindingDetail } from "@codevault/contracts";

import { StatePanel } from "./finding-detail.js";

const finding = {
  id: "018f2f56-7c9a-7abc-8def-0123456789ab",
  revision: 1,
  validationState: "CONFIRMED",
  remediationState: "UNFIXED",
  disclosureState: "PRIVATE",
  visibility: "INTERNAL",
} as unknown as FindingDetail;

describe("finding case capabilities", () => {
  it("lets a disclosure-only member change disclosure but not research state", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <StatePanel
          finding={finding}
          canEdit={false}
          canDisclose
          onError={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Disclosure")).toHaveProperty(
      "disabled",
      false,
    );
    expect(screen.getByLabelText("Validation")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText("Visibility")).toHaveProperty(
      "disabled",
      true,
    );
  });
});
