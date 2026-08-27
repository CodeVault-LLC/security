import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IntakeItem } from "@codevault/contracts";

import { queryKeys } from "../../lib/api.js";
import { FolderIntake } from "./folder-intake.js";
import { IntakeItemCard, IntakePanel } from "./intake-panel.js";

const apiBridge = vi.hoisted(() => ({ request: vi.fn() }));
const intakeBridge = vi.hoisted(() => ({
  previewFiles: vi.fn(),
  selectFolder: vi.fn(),
}));
const uploadsBridge = vi.hoisted(() => ({
  discard: vi.fn(),
  start: vi.fn(),
  validateSelections: vi.fn(),
}));

vi.mock("../../lib/bridge.js", () => ({
  bridge: () => ({
    api: apiBridge,
    intake: intakeBridge,
    uploads: uploadsBridge,
  }),
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

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

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

describe("finding file drop", () => {
  it("previews an explicitly dropped SARIF file", async () => {
    const caseId = ITEM.batch.caseId;
    const context = {
      findingTitles: [],
      artifactDigests: [],
      storedArtifacts: [],
    };
    const preview = {
      rootName: "results.sarif",
      files: [
        {
          relativePath: "results.sarif",
          sizeBytes: 128,
          sha256: "a".repeat(64),
          disposition: "MAPPED" as const,
        },
      ],
      candidates: [
        {
          clientId: "candidate-1",
          sourcePath: "results.sarif",
          sourceSha256: "a".repeat(64),
          draft: {
            title: "Dropped SARIF finding is ready for review",
            suggestedCweIds: [],
            affectedVersions: [],
          },
          status: "READY" as const,
          duplicateReasons: [],
        },
      ],
      attachments: [],
      errors: [],
      totalBytes: 128,
      selections: [
        {
          selectionId: "selection-1",
          filename: "results.sarif",
          sizeBytes: 128,
          mimeType: "application/sarif+json",
          sha256: "a".repeat(64),
          relativePath: "results.sarif",
          disposition: "MAPPED" as const,
        },
      ],
    };
    intakeBridge.previewFiles.mockResolvedValue({ ok: true, data: preview });
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    });
    client.setQueryData(["intake", caseId, "folder-context"], context);
    const file = new File(["{}"], "results.sarif", {
      type: "application/sarif+json",
    });

    render(
      <QueryClientProvider client={client}>
        <FolderIntake caseId={caseId} />
      </QueryClientProvider>,
    );
    fireEvent.drop(screen.getByText("Drop finding files here"), {
      dataTransfer: { files: [file] },
    });

    await waitFor(() =>
      expect(intakeBridge.previewFiles).toHaveBeenCalledWith([file], context),
    );
    expect(
      await screen.findByText("Dropped SARIF finding is ready for review"),
    ).toBeTruthy();
  });

  it("disables a restored preview when its local file access expired", async () => {
    const caseId = ITEM.batch.caseId;
    const context = {
      findingTitles: [],
      artifactDigests: [],
      storedArtifacts: [],
    };
    const preview = {
      rootName: "results.sarif",
      files: [
        {
          relativePath: "results.sarif",
          sizeBytes: 128,
          sha256: "a".repeat(64),
          disposition: "MAPPED" as const,
        },
      ],
      candidates: [
        {
          clientId: "candidate-1",
          sourcePath: "results.sarif",
          sourceSha256: "a".repeat(64),
          draft: {
            title: "Restored SARIF finding awaiting import",
            suggestedCweIds: [],
            affectedVersions: [],
          },
          status: "READY" as const,
          duplicateReasons: [],
        },
      ],
      attachments: [],
      errors: [],
      totalBytes: 128,
      selections: [
        {
          selectionId: "selection-from-previous-process",
          filename: "results.sarif",
          sizeBytes: 128,
          mimeType: "application/sarif+json",
          sha256: "a".repeat(64),
          relativePath: "results.sarif",
          disposition: "MAPPED" as const,
        },
      ],
    };
    localStorage.setItem(
      `codevault.folder-intake.signed-out.${caseId}`,
      JSON.stringify({
        preview,
        selectedIds: ["candidate-1"],
        uploaded: {},
      }),
    );
    uploadsBridge.validateSelections.mockResolvedValue({
      ok: true,
      data: { available: false },
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    });
    client.setQueryData(["intake", caseId, "folder-context"], context);

    render(
      <QueryClientProvider client={client}>
        <FolderIntake caseId={caseId} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(uploadsBridge.validateSelections).toHaveBeenCalledWith([
        "selection-from-previous-process",
      ]),
    );
    expect(
      await screen.findByText(
        "This preview lost access to its local source files after the desktop app restarted or the selection expired. Cancel the preview, then choose or drop the files again.",
      ),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Create 1 intake draft",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("uses a table for explicit per-finding inclusion decisions", async () => {
    const user = userEvent.setup();
    const caseId = ITEM.batch.caseId;
    const context = {
      findingTitles: [],
      artifactDigests: ["a".repeat(64)],
      storedArtifacts: [
        {
          id: "018f2f56-7c9a-7abc-8def-0123456789b0",
          filename: "results.sarif",
          sha256: "a".repeat(64),
        },
      ],
    };
    intakeBridge.previewFiles.mockResolvedValue({
      ok: true,
      data: {
        rootName: "results.sarif",
        files: [
          {
            relativePath: "results.sarif",
            sizeBytes: 128,
            sha256: "a".repeat(64),
            disposition: "MAPPED",
          },
        ],
        candidates: [
          {
            clientId: "ready-1",
            sourcePath: "results.sarif",
            sourceSha256: "a".repeat(64),
            draft: {
              title: "Ready finding from SARIF",
              suggestedCweIds: [],
              affectedVersions: [],
            },
            status: "READY",
            duplicateReasons: [],
          },
          {
            clientId: "review-1",
            sourcePath: "results.sarif",
            sourceSha256: "a".repeat(64),
            draft: {
              title: "Repeated finding from SARIF",
              suggestedCweIds: [],
              affectedVersions: [],
            },
            status: "DUPLICATE",
            duplicateReasons: [
              "The source file is already stored in this case; this is not a finding match.",
              "Another proposal in this import has the same normalized title.",
            ],
          },
        ],
        attachments: [],
        errors: [],
        totalBytes: 128,
        selections: [
          {
            selectionId: "selection-1",
            filename: "results.sarif",
            sizeBytes: 128,
            mimeType: "application/sarif+json",
            sha256: "a".repeat(64),
            relativePath: "results.sarif",
            disposition: "MAPPED",
          },
        ],
      },
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    });
    client.setQueryData(["intake", caseId, "folder-context"], context);
    const file = new File(["{}"], "results.sarif", {
      type: "application/sarif+json",
    });
    render(
      <QueryClientProvider client={client}>
        <FolderIntake caseId={caseId} />
      </QueryClientProvider>,
    );

    fireEvent.drop(screen.getByText("Drop finding files here"), {
      dataTransfer: { files: [file] },
    });

    expect(
      await screen.findByRole("table", { name: "Proposed findings" }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Include Ready finding from SARIF",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    const duplicateCheckbox = screen.getByRole("checkbox", {
      name: "Include Repeated finding from SARIF",
    }) as HTMLInputElement;
    expect(duplicateCheckbox.checked).toBe(false);
    expect(
      screen.getByText(
        "1 source file is already stored in this case and will be reused. This is a source-file match, not a finding match.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Possible duplicate")).toBeTruthy();

    await user.click(duplicateCheckbox);
    expect(
      (
        screen.getByRole("button", {
          name: "Create 2 intake drafts",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    apiBridge.request.mockResolvedValue({
      ok: true,
      data: {
        batchId: "018f2f56-7c9a-7abc-8def-0123456789b1",
        items: [
          ITEM,
          {
            ...ITEM,
            id: "018f2f56-7c9a-7abc-8def-0123456789b2",
          },
        ],
      },
    });
    await user.click(
      screen.getByRole("button", { name: "Create 2 intake drafts" }),
    );

    await waitFor(() => expect(apiBridge.request).toHaveBeenCalled());
    expect(uploadsBridge.start).not.toHaveBeenCalled();
    const createRequest = apiBridge.request.mock.calls[0];
    expect(createRequest?.[0]).toBe("/v1/intake/folder");
    expect(createRequest?.[1]).toMatchObject({
      method: "POST",
      body: {
        files: [
          {
            relativePath: "results.sarif",
            artifactId: "018f2f56-7c9a-7abc-8def-0123456789b0",
          },
        ],
      },
    });
  });

  it("shows the failed filename and upload error while preserving the preview", async () => {
    const user = userEvent.setup();
    const caseId = ITEM.batch.caseId;
    const context = {
      findingTitles: [],
      artifactDigests: [],
      storedArtifacts: [],
    };
    intakeBridge.previewFiles.mockResolvedValue({
      ok: true,
      data: {
        rootName: "results.sarif",
        files: [
          {
            relativePath: "results.sarif",
            sizeBytes: 128,
            sha256: "a".repeat(64),
            disposition: "MAPPED",
          },
        ],
        candidates: [
          {
            clientId: "candidate-1",
            sourcePath: "results.sarif",
            sourceSha256: "a".repeat(64),
            draft: {
              title: "SARIF finding awaiting upload",
              suggestedCweIds: [],
              affectedVersions: [],
            },
            status: "READY",
            duplicateReasons: [],
          },
        ],
        attachments: [],
        errors: [],
        totalBytes: 128,
        selections: [
          {
            selectionId: "selection-1",
            filename: "results.sarif",
            sizeBytes: 128,
            mimeType: "application/sarif+json",
            sha256: "a".repeat(64),
            relativePath: "results.sarif",
            disposition: "MAPPED",
          },
        ],
      },
    });
    uploadsBridge.start.mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            selectionId: "selection-1",
            artifactId: null,
            error: "Object storage rejected the upload.",
          },
        ],
      },
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    });
    client.setQueryData(["intake", caseId, "folder-context"], context);
    render(
      <QueryClientProvider client={client}>
        <FolderIntake caseId={caseId} />
      </QueryClientProvider>,
    );
    fireEvent.drop(screen.getByText("Drop finding files here"), {
      dataTransfer: {
        files: [
          new File(["{}"], "results.sarif", {
            type: "application/sarif+json",
          }),
        ],
      },
    });

    await user.click(
      await screen.findByRole("button", { name: "Create 1 intake draft" }),
    );

    expect(
      await screen.findByText(
        "results.sarif: Object storage rejected the upload. Retry to continue.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("SARIF finding awaiting upload")).toBeTruthy();
  });
});
