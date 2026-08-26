import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CorrespondenceMessage } from "@codevault/contracts";

import { queryKeys } from "../../lib/api.js";
import { CorrespondenceThread } from "./correspondence-thread.js";
import { buildCorrespondenceTranscript } from "./correspondence-transcript.js";

const exportTranscript = vi.hoisted(() => vi.fn());

vi.mock("../../lib/bridge.js", () => ({
  bridge: () => ({
    app: { openExternal: vi.fn() },
    correspondence: { decrypt: vi.fn(), exportTranscript },
  }),
}));

const message: CorrespondenceMessage = {
  id: "018f2f56-7c9a-7abc-8def-0123456789ab",
  submissionId: "018f2f56-7c9a-7abc-8def-0123456789ac",
  direction: "INBOUND",
  providerMessageId: "provider-1",
  providerThreadId: "thread-1",
  rfcMessageId: "<message@example.test>",
  inReplyTo: null,
  references: [],
  from: "security@vendor.example",
  to: ["researcher@example.test"],
  cc: ["coordinator@example.test"],
  subject: "Re: Vulnerability report",
  bodyText: null,
  encrypted: true,
  rawArtifactId: "018f2f56-7c9a-7abc-8def-0123456789ad",
  attachments: [
    {
      artifactId: "018f2f56-7c9a-7abc-8def-0123456789ae",
      filename: "vendor-response.txt",
      mimeType: "text/plain",
      sizeBytes: 42,
      sha256: "a".repeat(64),
      visibility: "VENDOR",
      status: "STORED",
      sourceRevision: null,
    },
  ],
  classification: "ACKNOWLEDGEMENT",
  receivedAt: "2026-08-26T08:30:00.000Z",
  sentAt: null,
  reviewedPlaintextSavedAt: null,
  createdAt: "2026-08-26T08:30:00.000Z",
  revision: 1,
};

describe("buildCorrespondenceTranscript", () => {
  it("includes locally decrypted content and auditable message metadata", () => {
    const transcript = buildCorrespondenceTranscript({
      submissionId: message.submissionId,
      generatedAt: "2026-08-26T09:00:00.000Z",
      messages: [message],
      localPlaintext: { [message.id]: "We are preparing a patch." },
    });

    expect(transcript).toContain("# Vendor correspondence transcript");
    expect(transcript).toContain("**Direction:** Inbound");
    expect(transcript).toContain("**Classification:** Acknowledgement");
    expect(transcript).toContain("We are preparing a patch.");
    expect(transcript).toContain(
      "vendor-response.txt · 42 bytes · sha256 aaaaaaaaaaaa",
    );
  });

  it("marks unavailable encrypted content instead of silently omitting it", () => {
    const transcript = buildCorrespondenceTranscript({
      submissionId: message.submissionId,
      generatedAt: "2026-08-26T09:00:00.000Z",
      messages: [message],
      localPlaintext: {},
    });

    expect(transcript).toContain(
      "Encrypted body not included. Decrypt it locally before exporting",
    );
  });
});

describe("CorrespondenceThread transcript export", () => {
  it("sends the visible thread to the trusted native save path", async () => {
    exportTranscript.mockResolvedValue({
      ok: true,
      data: { saved: true, sha256: "b".repeat(64) },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
    });
    client.setQueryData(queryKeys.correspondence(message.submissionId), {
      items: [{ ...message, encrypted: false, bodyText: "Stored response." }],
      sync: null,
    });
    render(
      <QueryClientProvider client={client}>
        <CorrespondenceThread
          submissionId={message.submissionId}
          submissionStatus="SENT"
          submissionRevision={1}
        />
      </QueryClientProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Export transcript" }),
    );

    await waitFor(() =>
      expect(exportTranscript).toHaveBeenCalledWith(
        message.submissionId,
        expect.stringContaining("Stored response."),
      ),
    );
  });
});
