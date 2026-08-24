import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { FindingDetail } from "@codevault/contracts";

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
