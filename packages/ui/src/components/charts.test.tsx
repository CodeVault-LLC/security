import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  BarList,
  formatCompact,
  Funnel,
  Meter,
  StackedBar,
  StageBar,
  StatTile,
  TrendChart,
} from "./charts.js";

/**
 * Chart tests.
 *
 * These assert on the hidden table each chart renders, not on its geometry. A
 * path's `d` attribute proves the shape has not changed; it does not prove the
 * number is right, and it breaks every time a margin moves. The table is also
 * the channel a screen reader reads, so testing it tests the thing that has to
 * be correct.
 *
 * The degenerate inputs are covered deliberately. Empty, single-point and
 * all-zero data are where charts divide by zero or draw a bar of infinite
 * width, and they are exactly what an empty workspace produces on first run.
 */

const severity = [
  {
    key: "critical",
    label: "Critical",
    value: 3,
    color: "--cv-severity-critical",
  },
  { key: "high", label: "High", value: 7, color: "--cv-severity-high" },
  { key: "low", label: "Low", value: 0, color: "--cv-severity-low" },
];

describe("formatCompact", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1_000, "1K"],
    [1_250, "1.3K"],
    [12_900, "12.9K"],
    [2_400_000, "2.4M"],
  ])("formats %i as %s", (input, expected) => {
    expect(formatCompact(input)).toBe(expected);
  });
});

describe("StackedBar", () => {
  it("puts every segment in the table, including empty ones", () => {
    render(<StackedBar segments={severity} caption="Severity" />);

    const table = screen.getByRole("table", { name: "Severity" });

    expect(within(table).getByText("Critical")).toBeInTheDocument();
    expect(within(table).getByText("High")).toBeInTheDocument();
    // Zero-valued segments draw nothing but must still be accounted for, or the
    // reader cannot tell "no lows" from "lows not measured".
    expect(within(table).getByText("Low")).toBeInTheDocument();
  });

  it("reports each segment's share of the total", () => {
    render(<StackedBar segments={severity} caption="Severity" />);

    const table = screen.getByRole("table", { name: "Severity" });

    expect(within(table).getByText("30.0%")).toBeInTheDocument();
    expect(within(table).getByText("70.0%")).toBeInTheDocument();
  });

  it("renders a legend carrying every label and count", () => {
    render(<StackedBar segments={severity} caption="Severity" />);

    const legend = screen.getByRole("list");

    expect(within(legend).getByText("Critical")).toBeInTheDocument();
    expect(within(legend).getByText("3")).toBeInTheDocument();
    expect(within(legend).getByText("7")).toBeInTheDocument();
  });

  it("describes the bar for a screen reader when compact hides the legend", () => {
    render(
      <StackedBar
        segments={severity}
        caption="Severity"
        compact
        description="Severity mix for Acme Router"
      />,
    );

    expect(
      screen.getByRole("img", { name: "Severity mix for Acme Router" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("says there is no data rather than drawing an empty bar", () => {
    render(
      <StackedBar
        segments={[{ key: "a", label: "A", value: 0 }]}
        caption="Severity"
      />,
    );

    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("survives having no segments at all", () => {
    render(<StackedBar segments={[]} caption="Severity" />);

    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });
});

describe("TrendChart", () => {
  const series = [
    { key: "opened", label: "Opened", points: [1, 4, 2] },
    { key: "published", label: "Published", points: [0, 1, 3] },
  ];

  it("tabulates every bucket against every series", () => {
    render(
      <TrendChart
        series={series}
        buckets={["W1", "W2", "W3"]}
        caption="Intake"
      />,
    );

    const table = screen.getByRole("table", { name: "Intake" });

    expect(within(table).getByText("W2")).toBeInTheDocument();
    expect(within(table).getAllByText("Opened")).not.toHaveLength(0);
  });

  it("shows a legend for two series", () => {
    render(
      <TrendChart
        series={series}
        buckets={["W1", "W2", "W3"]}
        caption="Intake"
      />,
    );

    const legend = screen.getByRole("list");

    expect(within(legend).getByText("Opened")).toBeInTheDocument();
    expect(within(legend).getByText("Published")).toBeInTheDocument();
  });

  it("omits the legend for a single series, since the title names it", () => {
    render(
      <TrendChart
        series={[{ key: "opened", label: "Opened", points: [1, 2, 3] }]}
        buckets={["W1", "W2", "W3"]}
        caption="Intake"
      />,
    );

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("refuses to plot a single point instead of drawing a line to nowhere", () => {
    render(
      <TrendChart
        series={[{ key: "opened", label: "Opened", points: [4] }]}
        buckets={["W1"]}
        caption="Intake"
      />,
    );

    expect(
      screen.getByText("Not enough history to plot yet"),
    ).toBeInTheDocument();
  });

  it("treats a missing bucket value as zero rather than omitting the row", () => {
    render(
      <TrendChart
        series={[{ key: "opened", label: "Opened", points: [1, 2] }]}
        buckets={["W1", "W2", "W3"]}
        caption="Intake"
      />,
    );

    const table = screen.getByRole("table", { name: "Intake" });
    const rows = within(table).getAllByRole("row");

    // Header plus three buckets: the third has no datum and must read 0.
    expect(rows).toHaveLength(4);
    expect(within(rows[3] as HTMLElement).getByText("0")).toBeInTheDocument();
  });
});

describe("BarList", () => {
  it("lists every item with its count", () => {
    render(
      <BarList
        items={[
          { key: "a", label: "CWE-79", value: 24 },
          { key: "b", label: "CWE-89", value: 15 },
        ]}
        caption="Weakness classes"
      />,
    );

    const table = screen.getByRole("table", { name: "Weakness classes" });

    expect(within(table).getByText("CWE-79")).toBeInTheDocument();
    expect(within(table).getByText("24")).toBeInTheDocument();
  });

  it("shows an empty state rather than an axis around nothing", () => {
    render(<BarList items={[]} caption="Weakness classes" />);

    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("draws nothing at all for a count of zero", () => {
    // A small value gets a minimum width so it stays visible. Zero must not:
    // a visible mark beside a 0 reads as "a few" at a glance.
    const { container } = render(
      <BarList
        items={[
          { key: "a", label: "CWE-79", value: 24 },
          { key: "b", label: "CWE-89", value: 0 },
        ]}
        caption="Weakness classes"
      />,
    );

    const widths = [...container.querySelectorAll<HTMLElement>("li span span")]
      .map((mark) => mark.style.width)
      .filter((width) => width.length > 0);

    expect(widths).toContain("0%");
  });

  it("keeps a long label out of the mark and in the table", () => {
    const label = "A weakness class with a name far too long for its row";

    render(
      <BarList items={[{ key: "a", label, value: 3 }]} caption="Classes" />,
    );

    const table = screen.getByRole("table", { name: "Classes" });

    // Present in full in the table, and never shortened with an ellipsis into
    // the mark — truncation is CSS on the visible label, so the value the
    // reader can copy is always complete.
    expect(within(table).getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(/…/)).not.toBeInTheDocument();
  });
});

describe("StageBar", () => {
  const stages = [
    {
      key: "contact",
      label: "Discovery to contact",
      p50Days: 4,
      p90Days: 11,
      sampleSize: 6,
    },
    {
      key: "ack",
      label: "Contact to acknowledgement",
      p50Days: null,
      p90Days: null,
      sampleSize: 0,
    },
  ];

  it("prints the sample size beside every stage", () => {
    render(<StageBar stages={stages} caption="Disclosure timing" />);

    expect(screen.getByText("n=6")).toBeInTheDocument();
    expect(screen.getByText("n=0")).toBeInTheDocument();
  });

  it("renders an unmeasured stage as a dash, not as zero days", () => {
    render(<StageBar stages={stages} caption="Disclosure timing" />);

    const table = screen.getByRole("table", { name: "Disclosure timing" });
    const rows = within(table).getAllByRole("row");

    expect(within(rows[2] as HTMLElement).getAllByText("—")).toHaveLength(2);
  });

  it("says nothing has completed when no stage has a median", () => {
    render(
      <StageBar
        stages={[
          {
            key: "ack",
            label: "Contact to acknowledgement",
            p50Days: null,
            p90Days: null,
            sampleSize: 0,
          },
        ]}
        caption="Disclosure timing"
      />,
    );

    expect(
      screen.getByText("No completed disclosure stages yet"),
    ).toBeInTheDocument();
  });
});

describe("Funnel", () => {
  it("tabulates each stage against the widest one", () => {
    render(
      <Funnel
        steps={[
          { key: "draft", label: "Draft", value: 10 },
          { key: "reproduced", label: "Reproduced", value: 5 },
        ]}
        caption="Validation"
      />,
    );

    const table = screen.getByRole("table", { name: "Validation" });

    expect(within(table).getByText("100.0%")).toBeInTheDocument();
    expect(within(table).getByText("50.0%")).toBeInTheDocument();
  });

  it("shows an empty state when every stage is zero", () => {
    render(
      <Funnel
        steps={[{ key: "draft", label: "Draft", value: 0 }]}
        caption="Validation"
      />,
    );

    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("draws nothing for a stage nothing has reached", () => {
    const { container } = render(
      <Funnel
        steps={[
          { key: "draft", label: "Draft", value: 10 },
          { key: "invalid", label: "Invalid", value: 0 },
        ]}
        caption="Validation"
      />,
    );

    const widths = [...container.querySelectorAll<HTMLElement>("li span span")]
      .map((mark) => mark.style.width)
      .filter((width) => width.length > 0);

    expect(widths).toContain("0%");
  });
});

describe("StatTile", () => {
  it("renders its label and compacted value", () => {
    render(<StatTile label="Open findings" value={12_900} />);

    expect(screen.getByText("Open findings")).toBeInTheDocument();
    expect(screen.getByText("12.9K")).toBeInTheDocument();
  });

  it("passes a string value through untouched, for a suppressed figure", () => {
    render(<StatTile label="Median ack" value="—" hint="Too few cases" />);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Too few cases")).toBeInTheDocument();
  });

  it("colours a delta by whether the direction is good, not by its sign", () => {
    const { container } = render(
      <StatTile
        label="Criticals unfixed"
        value={4}
        delta={{ value: 2, period: "30d", upIsGood: false }}
      />,
    );

    expect(container.querySelector(".text-warning")).not.toBeNull();
  });
});

describe("Meter", () => {
  it("exposes its value to assistive technology", () => {
    render(<Meter label="Identifier coverage" value={41} total={100} />);

    const meter = screen.getByRole("meter", { name: "Identifier coverage" });

    expect(meter).toHaveAttribute("aria-valuenow", "41");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
  });

  it("does not divide by zero on an empty workspace", () => {
    render(<Meter label="Identifier coverage" value={0} total={0} />);

    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});
