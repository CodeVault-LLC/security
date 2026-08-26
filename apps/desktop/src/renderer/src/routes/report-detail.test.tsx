import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LintResult,
  ReportDetail,
  ReportExport,
  ReportPreview,
  ReportSection,
} from "@codevault/contracts";

import { queryKeys } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { ReportDetailRoute } from "./report-detail.js";

const REPORT_ID = "018f2f56-7c9a-7abc-8def-0123456789ab";
const ARTIFACT_ID = "018f2f56-7c9a-7abc-8def-0123456789ac";

const apiBridge = vi.hoisted(() => ({ request: vi.fn() }));
const appBridge = vi.hoisted(() => ({ openExternal: vi.fn() }));
const reportsBridge = vi.hoisted(() => ({ downloadPdf: vi.fn() }));

vi.mock("../lib/bridge.js", () => ({
  bridge: () => ({
    api: apiBridge,
    app: appBridge,
    reports: reportsBridge,
  }),
}));

const actor = {
  id: "018f2f56-7c9a-7abc-8def-0123456789ad",
  email: "researcher@example.test",
  displayName: "Researcher",
};

const report: ReportDetail = {
  id: REPORT_ID,
  ref: "REP-2026-0001",
  caseId: "018f2f56-7c9a-7abc-8def-0123456789ae",
  audience: "INTERNAL",
  templateId: "builtin-internal-v1",
  title: "Completed security report",
  tlp: "TLP:AMBER",
  visibilityCeiling: "INTERNAL",
  status: "APPROVED",
  sectionCount: 0,
  approvedSectionCount: 0,
  sections: [],
  approvals: [],
  createdAt: "2026-08-24T10:00:00.000Z",
  updatedAt: "2026-08-24T10:00:00.000Z",
  revision: 2,
};

const lint: LintResult = {
  findings: [],
  blocking: false,
  checkedAt: "2026-08-24T10:00:00.000Z",
};
const preview: ReportPreview = {
  html: "<!doctype html><html><body><main><section><p>Rendered report content.</p></section></main></body></html>",
  lint,
  tlp: "TLP:AMBER",
};
const completedExport: ReportExport = {
  id: "018f2f56-7c9a-7abc-8def-0123456789af",
  reportId: REPORT_ID,
  format: "PDF",
  status: "COMPLETED",
  artifactId: ARTIFACT_ID,
  sha256: "a".repeat(64),
  tlp: "TLP:AMBER",
  templateVersion: "1",
  failureReason: null,
  requestedBy: actor,
  createdAt: "2026-08-24T10:01:00.000Z",
  completedAt: "2026-08-24T10:02:00.000Z",
};

const section: ReportSection = {
  id: "018f2f56-7c9a-7abc-8def-0123456789b0",
  reportId: REPORT_ID,
  key: "summary",
  title: "Summary",
  position: 0,
  required: true,
  contentMarkdown: "# Summary\n\nRendered report content.",
  reviewState: "APPROVED",
  promptPurpose: "Explain the issue and its impact.",
  approvedBy: null,
  approvedAt: null,
  approvedRevision: null,
  lastEditedBy: actor,
  sourceRefs: [],
  updatedAt: "2026-08-24T10:00:00.000Z",
  revision: 1,
};

function renderReport(detail: ReportDetail = report): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  client.setQueryData(queryKeys.report(REPORT_ID), detail);
  client.setQueryData(queryKeys.reportLint(REPORT_ID), lint);
  client.setQueryData(queryKeys.reportPreview(REPORT_ID), preview);
  client.setQueryData(queryKeys.reportExports(REPORT_ID), {
    items: [completedExport],
  });

  render(
    <QueryClientProvider client={client}>
      <ReportDetailRoute reportId={REPORT_ID} />
    </QueryClientProvider>,
  );
}

describe("completed report exports", () => {
  beforeEach(() => {
    apiBridge.request.mockReset();
    apiBridge.request.mockResolvedValue({
      ok: true,
      data: { url: "http://127.0.0.1:9000/report.pdf" },
    });
    appBridge.openExternal.mockReset();
    reportsBridge.downloadPdf.mockReset();
    reportsBridge.downloadPdf.mockResolvedValue({
      ok: true,
      data: { saved: true, sha256: completedExport.sha256 },
    });
    useSession.getState().signIn(
      {
        ...actor,
        role: "MEMBER",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastLoginAt: null,
      },
      null,
    );
  });

  it("saves a PDF through the trusted native download path", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(screen.getByRole("button", { name: "Report details" }));
    await user.click(screen.getByRole("menuitem", { name: "Show exports" }));
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(reportsBridge.downloadPdf).toHaveBeenCalledWith(ARTIFACT_ID);
    expect(apiBridge.request).not.toHaveBeenCalled();
    expect(appBridge.openExternal).not.toHaveBeenCalled();
  });
});

describe("report preview", () => {
  it("opens on the writing buffer with secondary panels hidden", () => {
    useSession.getState().signIn(
      {
        ...actor,
        role: "VIEWER",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastLoginAt: null,
      },
      null,
    );

    renderReport({
      ...report,
      sectionCount: 1,
      approvedSectionCount: 1,
      sections: [section],
    });

    expect(
      screen.getByRole("textbox", { name: "Summary report section" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    expect(screen.queryByLabelText("Report sections")).toBeNull();
  });

  it("opens a focused full-screen reading view and closes with Escape", async () => {
    const user = userEvent.setup();

    useSession.getState().signIn(
      {
        ...actor,
        role: "VIEWER",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastLoginAt: null,
      },
      null,
    );

    renderReport({
      ...report,
      sectionCount: 1,
      approvedSectionCount: 1,
      sections: [section],
    });

    await user.click(screen.getByRole("button", { name: "Preview" }));

    const trigger = screen.getByRole("button", { name: "Full screen" });

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "Completed security report preview",
    });

    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText("Rendered report content.")).toBeTruthy();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
