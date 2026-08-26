import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FindingDetail } from "@codevault/contracts";

import { intelligenceFreshness } from "./intelligence-freshness.js";
import { ScoringPanel } from "./scoring-panel.js";

vi.mock("@codevault/ui", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const React = await import("react");

  function MockSelect(props: {
    "aria-label"?: string;
    disabled?: boolean;
    onValueChange: (value: string) => void;
    options: readonly { label: string; value: string }[];
    value?: string;
  }): React.JSX.Element {
    return React.createElement(
      "select",
      {
        "aria-label": props["aria-label"],
        disabled: props.disabled,
        value: props.value,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
          props.onValueChange(event.target.value),
      },
      props.options.map((option) =>
        React.createElement(
          "option",
          { key: option.value, value: option.value },
          option.label,
        ),
      ),
    );
  }

  return { ...actual, Select: MockSelect };
});

const FINDING = {
  id: "018f2f56-7c9a-7abc-8def-0123456789ab",
  revision: 1,
  cweIds: [],
  scores: [],
} as unknown as FindingDetail;

afterEach(() => vi.useRealTimers());

function renderPanel(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <ScoringPanel finding={FINDING} canEdit />
    </QueryClientProvider>,
  );
}

describe("alternative scoring UI", () => {
  it("offers the independent assessment schemes and their metric forms", async () => {
    const user = userEvent.setup();
    renderPanel();
    const scheme = screen.getByRole("combobox", { name: "Scoring scheme" });

    await user.selectOptions(scheme, "CWSS10");
    expect(screen.getByText("Base Finding")).toBeTruthy();
    expect(screen.getByLabelText("Technical Impact")).toBeTruthy();

    await user.selectOptions(scheme, "OWASP_RR");
    expect(screen.getByText("Threat Agent")).toBeTruthy();
    expect(screen.getByLabelText("Financial Damage")).toHaveProperty(
      "value",
      "X",
    );

    await user.selectOptions(scheme, "SSVC");
    expect(screen.getByLabelText("Supplier Involvement")).toBeTruthy();
    expect(screen.getByText("PUBLISH")).toBeTruthy();

    await user.selectOptions(scheme, "EVSS");
    expect(screen.getByLabelText("EVSS score (0–10)")).toBeTruthy();
    expect(screen.getByText(/EVSS is proprietary/)).toBeTruthy();
  });
});

describe("retrieved intelligence freshness", () => {
  it("uses a tighter freshness window for daily EPSS and KEV data", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");

    expect(
      intelligenceFreshness("EPSS", "2026-08-25T12:00:00.000Z", now),
    ).toMatchObject({ state: "FRESH", thresholdDays: 2 });
    expect(
      intelligenceFreshness("KEV", "2026-08-23T12:00:00.000Z", now),
    ).toMatchObject({ state: "STALE", thresholdDays: 2 });
    expect(
      intelligenceFreshness("EVSS", "2026-08-01T12:00:00.000Z", now),
    ).toMatchObject({ state: "FRESH", thresholdDays: 30 });
  });

  it("warns when recorded intelligence is stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
    const externalScore = {
      id: "018f2f56-7c9a-7abc-8def-0123456789ac",
      scheme: "EPSS",
      vector: null,
      score: 0.42,
      severity: null,
      metrics: {},
      source: "EXTERNAL",
      reasoningMarkdown: null,
      reviewState: "APPROVED",
      reviewedBy: null,
      reviewedAt: null,
      sourceName: "FIRST EPSS",
      retrievedAt: "2026-08-20T12:00:00.000Z",
      createdAt: "2026-08-20T12:00:00.000Z",
    } as const;

    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <ScoringPanel
          finding={{ ...FINDING, scores: [externalScore] }}
          canEdit
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/1 intelligence source is stale/)).toBeTruthy();
    expect(screen.getByText("Stale")).toBeTruthy();
  });
});
