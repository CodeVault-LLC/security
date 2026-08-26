import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { FindingSummary } from "@codevault/contracts";

import { BulkRemediationControls } from "./bulk-remediation-controls.js";

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock("../../lib/bridge.js", () => ({
  bridge: () => ({ api: { request: apiRequest } }),
}));

const findings: FindingSummary[] = [
  "Parser bypass",
  "Authorization bypass",
].map((title, index) => ({
  id: `11111111-1111-4111-8111-11111111111${index}`,
  ref: `FIND-${index + 1}`,
  caseId: "22222222-2222-4222-8222-222222222222",
  caseRef: "CASE-42",
  title,
  summaryMarkdown: null,
  validationState: "CONFIRMED",
  remediationState: "UNFIXED",
  disclosureState: "PRIVATE",
  externalIdState: "NONE",
  priorArtState: "UNCHECKED",
  severity: "HIGH",
  score: 8.1,
  primaryAsset: null,
  pendingProposalCount: 0,
  createdAt: "2026-08-26T12:00:00.000Z",
  updatedAt: "2026-08-26T12:00:00.000Z",
  revision: index + 2,
}));

describe("BulkRemediationControls", () => {
  it("requires review before sending revision-checked selections", async () => {
    apiRequest.mockResolvedValue({
      ok: true,
      data: { updatedIds: findings.map((finding) => finding.id) },
    });
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <BulkRemediationControls
          caseId={findings[0]!.caseId}
          findings={findings}
          selectedIds={new Set(findings.map((finding) => finding.id))}
          onComplete={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Review bulk change" }),
    );
    expect(screen.getByText(/Set 2 findings to Fixed/)).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Apply to 2 findings" }),
    );

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/v1/findings/actions/bulk-remediation",
        {
          method: "POST",
          body: {
            caseId: findings[0]!.caseId,
            remediationState: "FIXED",
            items: findings.map((finding) => ({
              id: finding.id,
              expectedRevision: finding.revision,
            })),
          },
        },
      ),
    );
  });
});
