import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { IntakeItem } from "@codevault/contracts";

import { queryKeys } from "../../lib/api.js";
import { IntakeItemCard, IntakePanel } from "./intake-panel.js";

const apiBridge = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("../../lib/bridge.js", () => ({
  bridge: () => ({ api: apiBridge }),
}));

const ITEM: IntakeItem = {
  id: "018f2f56-7c9a-7abc-8def-0123456789ab",
  batch: {
    id: "018f2f56-7c9a-7abc-8def-0123456789ac",
    caseId: "018f2f56-7c9a-7abc-8def-0123456789ad",
    source: "MANUAL",
    sourceLabel: "Imported notebook",
    runId: null,
    manifest: {},
    createdBy: {
      id: "018f2f56-7c9a-7abc-8def-0123456789ae",
      displayName: "Researcher",
      email: "researcher@example.com",
    },
    createdAt: "2026-08-17T12:00:00.000Z",
  },
  status: "PENDING",
  draft: {
    title: "Unauthenticated SQL injection in report export",
    summaryMarkdown: "A crafted request reaches the query layer.",
    suggestedCweIds: ["CWE-89"],
    affectedVersions: [],
  },
  citations: [],
  confidence: "HIGH",
  createdFindingId: null,
  mergedIntoFindingId: null,
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  revision: 1,
  createdAt: "2026-08-17T12:00:00.000Z",
};

describe("IntakeItemCard", () => {
  it("shows the pending draft and its provenance", () => {
    render(
      <IntakeItemCard
        item={ITEM}
        canEdit
        busy={false}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText(ITEM.draft.title)).toBeTruthy();
    expect(screen.getByText(/Imported notebook/)).toBeTruthy();
    expect(screen.getByText(/high confidence/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  });

  it("asks for a rejection reason before rejecting", async () => {
    const user = userEvent.setup();
    const onReject = vi.fn();
    render(
      <IntakeItemCard
        item={ITEM}
        canEdit
        busy={false}
        onAccept={vi.fn()}
        onReject={onReject}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(onReject).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Rejection reason"), "Duplicate");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(onReject).toHaveBeenCalledWith("Duplicate");
  });

  it("offers merge when an existing finding is available", () => {
    render(
      <IntakeItemCard
        item={ITEM}
        canEdit
        busy={false}
        findingOptions={[
          {
            id: "018f2f56-7c9a-7abc-8def-0123456789af",
            label: "FIND-2026-0001 · Existing SQL injection",
          },
        ]}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onSave={vi.fn()}
        onMerge={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Merge" })).toBeTruthy();
  });
});

describe("bulk intake acceptance", () => {
  it("requires explicit selection and confirmation before accepting drafts", async () => {
    const user = userEvent.setup();
    const second = {
      ...ITEM,
      id: "018f2f56-7c9a-7abc-8def-0123456789af",
      draft: { ...ITEM.draft, title: "Second imported vulnerability draft" },
      revision: 3,
    };
    apiBridge.request.mockResolvedValue({
      ok: true,
      data: { items: [] },
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    });
    client.setQueryData(queryKeys.intake(ITEM.batch.caseId), {
      items: [ITEM, second],
    });
    render(
      <QueryClientProvider client={client}>
        <IntakePanel caseId={ITEM.batch.caseId} canEdit findings={[]} />
      </QueryClientProvider>,
    );

    await user.click(
      screen.getByRole("checkbox", { name: `Select ${ITEM.draft.title}` }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: `Select ${second.draft.title}` }),
    );
    await user.click(
      screen.getByRole("button", { name: "Review accepting 2 drafts" }),
    );
    expect(screen.getByText("Accept 2 drafts as new findings?")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Confirm accepting 2 drafts" }),
    );

    await waitFor(() =>
      expect(apiBridge.request).toHaveBeenCalledWith("/v1/intake/bulk-accept", {
        method: "POST",
        body: {
          caseId: ITEM.batch.caseId,
          items: [
            { id: ITEM.id, expectedRevision: ITEM.revision },
            { id: second.id, expectedRevision: second.revision },
          ],
        },
      }),
    );
  });
});
