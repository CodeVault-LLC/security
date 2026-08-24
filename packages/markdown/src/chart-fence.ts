import type { Element, Root, Text } from "hast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

/**
 * Structured data charts.
 *
 * A fenced `chart` block contains a small JSON document. The renderer turns it
 * into ordinary, sanitised HTML before either the desktop preview or the PDF
 * sees it. That keeps charts deterministic, printable, and usable without
 * JavaScript or network access.
 */

const MAX_POINTS = 24;
const MAX_TITLE_LENGTH = 120;
const MAX_LABEL_LENGTH = 80;
const MAX_UNIT_LENGTH = 24;

interface ChartPoint {
  label: string;
  value: number;
}

interface ChartSpec {
  title: string;
  unit: string | null;
  data: ChartPoint[];
}

function languageOf(node: Element): string | null {
  const className = node.properties?.className;

  if (!Array.isArray(className)) {
    return null;
  }

  for (const entry of className) {
    if (typeof entry === "string" && entry.startsWith("language-")) {
      return entry.slice("language-".length).toLowerCase();
    }
  }

  return null;
}

function sourceOf(node: Element): string {
  return node.children
    .filter((child): child is Text => child.type === "text")
    .map((child) => child.value)
    .join("");
}

function text(value: string): Text {
  return { type: "text", value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 && trimmed.length <= maximum ? trimmed : null;
}

function parseChart(source: string): ChartSpec | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const title = boundedString(parsed.title, MAX_TITLE_LENGTH);
  const unit =
    parsed.unit === undefined
      ? null
      : boundedString(parsed.unit, MAX_UNIT_LENGTH);

  if (
    title === null ||
    (parsed.unit !== undefined && unit === null) ||
    !Array.isArray(parsed.data) ||
    parsed.data.length === 0 ||
    parsed.data.length > MAX_POINTS
  ) {
    return null;
  }

  const data: ChartPoint[] = [];

  for (const candidate of parsed.data) {
    if (!isRecord(candidate)) {
      return null;
    }

    const label = boundedString(candidate.label, MAX_LABEL_LENGTH);
    const value = candidate.value;

    if (
      label === null ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      return null;
    }

    data.push({ label, value });
  }

  return { title, unit, data };
}

function formatValue(value: number, unit: string | null): string {
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);

  return unit === null ? formatted : `${formatted} ${unit}`;
}

function chartElement(spec: ChartSpec): Element {
  const maximum = Math.max(...spec.data.map((point) => point.value));
  const rows: Element[] = spec.data.map((point) => {
    const ratio = maximum === 0 ? 0 : (point.value / maximum) * 100;

    return {
      type: "element",
      tagName: "div",
      properties: { className: ["cv-data-chart-row"] },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: { className: ["cv-data-chart-label"] },
          children: [text(point.label)],
        },
        {
          type: "element",
          tagName: "span",
          properties: { className: ["cv-data-chart-track"] },
          children: [
            {
              type: "element",
              tagName: "span",
              properties: {
                className: [
                  "cv-data-chart-fill",
                  ...(point.value > 0 ? ["cv-data-chart-fill--visible"] : []),
                ],
                style: `--cv-data-ratio:${Number(ratio.toFixed(4))}%`,
              },
              children: [],
            },
          ],
        },
        {
          type: "element",
          tagName: "span",
          properties: { className: ["cv-data-chart-value"] },
          children: [text(formatValue(point.value, spec.unit))],
        },
      ],
    };
  });

  return {
    type: "element",
    tagName: "figure",
    properties: { className: ["cv-data-chart"] },
    children: [
      {
        type: "element",
        tagName: "figcaption",
        properties: { className: ["cv-data-chart-title"] },
        children: [text(spec.title)],
      },
      {
        type: "element",
        tagName: "div",
        properties: { className: ["cv-data-chart-plot"] },
        children: rows,
      },
    ],
  };
}

function invalidChartElement(source: Element): Element {
  source.properties = {};

  return {
    type: "element",
    tagName: "div",
    properties: { className: ["cv-data-chart", "cv-data-chart--invalid"] },
    children: [
      {
        type: "element",
        tagName: "p",
        properties: { className: ["cv-data-chart-error"] },
        children: [
          text(
            "Chart could not be rendered. Use valid JSON with a title and one to 24 non-negative data values.",
          ),
        ],
      },
      {
        type: "element",
        tagName: "pre",
        properties: { className: ["cv-data-chart-source"] },
        children: [source],
      },
    ],
  };
}

/** Rewrites a `chart` fence into a printable horizontal bar chart. */
export const rehypeChartFence: Plugin<[], Root> = () => (tree) => {
  visit(tree, "element", (node: Element, index, parent) => {
    if (node.tagName !== "pre" || parent === undefined || index === undefined) {
      return;
    }

    const [code] = node.children.filter(
      (child): child is Element =>
        child.type === "element" && child.tagName === "code",
    );

    if (code === undefined || languageOf(code) !== "chart") {
      return;
    }

    const spec = parseChart(sourceOf(code));

    parent.children[index] =
      spec === null ? invalidChartElement(code) : chartElement(spec);
  });
};
