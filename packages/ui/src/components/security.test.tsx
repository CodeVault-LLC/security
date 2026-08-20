import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Artifact } from "@codevault/contracts";

import { EvidenceCard } from "./security.js";

const artifact: Artifact = {
  id: "00000000-0000-4000-8000-000000000001",
  caseId: "00000000-0000-4000-8000-000000000002",
  findingId: "00000000-0000-4000-8000-000000000003",
  filename: "proof.png",
  mimeType: "image/png",
  sizeBytes: 2048,
  sha256: "a".repeat(64),
  artifactKind: "SCREENSHOT",
  visibility: "INTERNAL",
  status: "STORED",
  uploadedBy: {
    id: "00000000-0000-4000-8000-000000000004",
    displayName: "Researcher",
    email: "researcher@codevault.test",
  },
  capturedAt: null,
  metadata: {},
  previewKind: null,
  previewText: null,
  createdAt: "2026-08-20T10:00:00.000Z",
};

function renderEvidence(overrides: Partial<Artifact> = {}) {
  const onLoadArtifact = vi
    .fn()
    .mockResolvedValue("https://files.test/proof.png");

  render(
    <EvidenceCard
      reference="EVID-000001"
      title="Authentication bypass"
      visibility="INTERNAL"
      artifacts={[{ ...artifact, ...overrides }]}
      onLoadArtifact={onLoadArtifact}
      onOpenArtifact={vi.fn()}
    />,
  );

  return { onLoadArtifact };
}

describe("EvidenceCard", () => {
  it("loads and displays a safe raster preview only after the user asks", async () => {
    const { onLoadArtifact } = renderEvidence();

    expect(screen.queryByRole("img", { name: /preview of proof/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview proof.png" }));

    await waitFor(() =>
      expect(onLoadArtifact).toHaveBeenCalledWith(artifact.id),
    );
    expect(
      screen.getByRole("img", { name: /preview of proof/i }),
    ).toHaveAttribute("src", "https://files.test/proof.png");
    expect(
      screen.getByRole("button", { name: "Hide proof.png" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("renders an existing text excerpt without requesting a download URL", () => {
    const { onLoadArtifact } = renderEvidence({
      filename: "request.txt",
      mimeType: "text/plain",
      artifactKind: "HTTP_CAPTURE",
      previewKind: "TEXT_EXCERPT",
      previewText: "GET /admin HTTP/1.1",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Preview request.txt" }),
    );

    expect(screen.getByText("GET /admin HTTP/1.1")).toBeInTheDocument();
    expect(onLoadArtifact).not.toHaveBeenCalled();
  });

  it("explains why an artifact that is still processing cannot be opened", () => {
    renderEvidence({ status: "VERIFYING" });

    expect(screen.getByText(/verifying/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open proof.png" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Open proof.png" }),
    ).toHaveAttribute("title", "File is verifying");
  });
});
