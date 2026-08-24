import { defineChart, lineY } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo, type ReactNode } from "react";

import { cn } from "../lib/cn.js";

/**
 * Chart primitives.
 *
 * Deliberately domain-free: these take numbers and labels and return marks. No
 * chart here knows that critical is red or that a funnel runs Draft to
 * Confirmed — that belongs to the feature code and to the tokens, which is what
 * lets the same six components serve the dashboard, the asset pages and the
 * metrics screen without any of them growing a special case.
 *
 * Colour arrives as a custom-property *name* (`--cv-severity-critical`), never
 * a hex value, so light and dark follow the existing theme switch and there is
 * no second palette to keep in step.
 *
 * Most of these are HTML rather than SVG. A stacked bar is proportional boxes,
 * and HTML gives real pixel gaps and real text layout; SVG would mean scaling a
 * `viewBox` and then fighting it to keep a 2px gap 2px and a label unclipped.
 * Only the trend line, which genuinely needs a coordinate system, is SVG.
 *
 * Every component renders a visually hidden table carrying the plotted values.
 * That is what keeps the numbers reachable when colour is not — and it is what
 * the tests assert against, because asserting on path geometry would prove the
 * shape is stable without proving the number is right.
 */

/** A named quantity with a colour token. The unit of most charts here. */
export interface ChartDatum {
  key: string;
  label: string;
  value: number;
  /** Custom-property name, e.g. `--cv-severity-high`. Defaults to the accent. */
  color?: string;
}

const DEFAULT_COLOR = "--cv-accent";

const paint = (token: string | undefined): string =>
  `var(${token ?? DEFAULT_COLOR})`;

/**
 * Compact figures for headline values.
 *
 * Proportional figures, not tabular: equal-width digits make a number like 121
 * look loose at display sizes. Table cells and axis ticks get `tabular-nums`
 * instead, where digits genuinely need to line up.
 */
export function formatCompact(value: number): string {
  const magnitude = Math.abs(value);

  if (magnitude < 1_000) {
    return String(value);
  }

  if (magnitude < 1_000_000) {
    const thousands = value / 1_000;

    return `${thousands.toFixed(magnitude % 1_000 === 0 ? 0 : 1)}K`;
  }

  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-GB");
}

const percentage = (value: number, total: number): number =>
  total <= 0 ? 0 : (value / total) * 100;

/**
 * Bar width, with a floor so a small value stays visible.
 *
 * Zero is exempt, and that exemption is the point: a bar of nothing must draw
 * nothing. Applying the minimum uniformly puts a visible mark next to a count
 * of 0, which reads as "a few" at a glance and is the one thing a chart of
 * counts must never do.
 */
const barWidth = (value: number, ceiling: number): string =>
  value <= 0 ? "0%" : `${Math.max(percentage(value, ceiling), 1.5)}%`;

/**
 * The accessible twin of a chart.
 *
 * Not `aria-hidden` decoration and not a fallback: this is where a screen
 * reader, a text search and the test suite all read the actual values from.
 */
function ChartTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}): React.JSX.Element {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row[0] ?? String(index)}>
            {row.map((cell, cellIndex) => (
              <td key={`${cellIndex}-${cell}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Shown in place of a chart when there is genuinely nothing to plot. */
function NoData({
  message = "No data yet",
  className,
}: {
  message?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <p
      className={cn(
        "flex items-center justify-center py-4 text-[11px] text-text-muted",
        className,
      )}
    >
      {message}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat tile                                                                  */
/* -------------------------------------------------------------------------- */

export interface StatTileProps {
  label: string;
  value: number | string;
  /** Signed change against a named period, e.g. `{ value: 4, period: "30d" }`. */
  delta?: { value: number; period: string; upIsGood?: boolean };
  /** Replaces the value when there is nothing to show, e.g. too small a sample. */
  hint?: string;
  className?: string;
}

/**
 * One headline number.
 *
 * A stat tile, not a hero figure: a hero is for the single number a view leads
 * with, and these appear in rows of four. Inflating one of them to 48px would
 * assert a priority the data does not have.
 */
export function StatTile({
  label,
  value,
  delta,
  hint,
  className,
}: StatTileProps): React.JSX.Element {
  const display = typeof value === "number" ? formatCompact(value) : value;
  const upIsGood = delta?.upIsGood ?? true;
  const improving = delta === undefined ? false : delta.value >= 0 === upIsGood;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-(--cv-radius) border border-border bg-surface px-3 py-2",
        className,
      )}
    >
      <span className="truncate text-[11px] uppercase tracking-[0.07em] text-text-muted">
        {label}
      </span>

      <span className="text-[20px] font-semibold leading-6">{display}</span>

      {delta === undefined ? (
        hint === undefined ? null : (
          <span className="truncate text-[11px] text-text-muted">{hint}</span>
        )
      ) : (
        <span
          className={cn(
            "truncate text-[11px]",
            improving ? "text-success" : "text-warning",
          )}
        >
          {delta.value >= 0 ? "+" : "−"}
          {formatCompact(Math.abs(delta.value))} vs {delta.period}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stacked bar                                                                */
/* -------------------------------------------------------------------------- */

interface StackedBarBase {
  segments: readonly ChartDatum[];
  /** Caption for the hidden table. Describes what the whole bar covers. */
  caption: string;
  className?: string;
}

/**
 * Stacked bar props.
 *
 * The union is the point. A bar either shows its legend, or it is explicitly
 * `compact` and must then supply a `description` — there is no way to spell a
 * multi-segment bar that carries neither. Severity colours sit close enough
 * together (critical and high are both reds, measured at ΔE 8.4) that a
 * colour-only bar would be genuinely ambiguous, so the type refuses to express
 * one rather than relying on everyone remembering.
 */
export type StackedBarProps = StackedBarBase &
  (
    | { compact?: false; description?: undefined }
    | { compact: true; description: string }
  );

export function StackedBar({
  segments,
  caption,
  compact,
  description,
  className,
}: StackedBarProps): React.JSX.Element {
  const present = segments.filter((segment) => segment.value > 0);
  const total = present.reduce((sum, segment) => sum + segment.value, 0);

  const table = (
    <ChartTable
      caption={caption}
      columns={["Category", "Count", "Share"]}
      rows={segments.map((segment) => [
        segment.label,
        formatCount(segment.value),
        `${percentage(segment.value, total).toFixed(1)}%`,
      ])}
    />
  );

  if (total === 0) {
    return (
      <div className={className}>
        <NoData />
        {table}
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      {/* A 2px gap in the surface colour separates the segments. A stroke around
          each one would add ink that is not data, and at these widths it reads
          as a border rather than as separation. */}
      <div
        className={cn(
          "flex w-full gap-0.5 overflow-hidden",
          compact ? "h-2" : "h-3",
        )}
        role="img"
        aria-label={description ?? caption}
      >
        {present.map((segment) => (
          <span
            key={segment.key}
            title={`${segment.label}: ${formatCount(segment.value)}`}
            style={{
              width: `${percentage(segment.value, total)}%`,
              background: paint(segment.color),
            }}
            className="first:rounded-l-[2px] last:rounded-r-[2px]"
          />
        ))}
      </div>

      {compact === true ? null : (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {segments.map((segment) => (
            <li
              key={segment.key}
              className="flex items-center gap-1.5 text-[11px]"
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[1px]"
                style={{ background: paint(segment.color) }}
              />
              <span className="text-text-muted">{segment.label}</span>
              <span className="font-mono tabular-nums text-text">
                {formatCount(segment.value)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {table}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend chart                                                                */
/* -------------------------------------------------------------------------- */

export interface TrendSeries {
  key: string;
  label: string;
  points: readonly number[];
  color?: string;
}

export interface TrendChartProps {
  series: readonly TrendSeries[];
  /** One label per bucket. Only the first and last are drawn. */
  buckets: readonly string[];
  caption: string;
  className?: string;
}

/**
 * Change over time.
 *
 * TanStack Charts owns scale calculation, responsive measurement, axes,
 * keyboard focus, and tooltip positioning. The CodeVault interface stays
 * unchanged so every existing metrics caller and accessible value table keeps
 * working while the plotting implementation can evolve in one module.
 */
export function TrendChart({
  series,
  buckets,
  caption,
  className,
}: TrendChartProps): React.JSX.Element {
  const plotted = series.filter((entry) => entry.points.length > 0);
  const definition = useMemo(() => {
    const marks = plotted.map((entry) =>
      lineY(
        buckets.map((bucket, index) => ({
          bucket,
          index,
          value: entry.points[index] ?? 0,
        })),
        {
          id: entry.label,
          x: "index",
          y: "value",
          stroke: paint(entry.color),
          strokeWidth: 2,
          points: true,
        },
      ),
    );

    return defineChart({
      marks,
      x: { scale: scaleLinear, axis: false },
      y: {
        scale: scaleLinear,
        nice: true,
        grid: true,
        axis: {
          ticks: { count: 3, format: (value) => formatCompact(value) },
        },
      },
      clip: true,
      tooltip,
      svgAnimation: false,
    });
  }, [buckets, plotted]);

  const table = (
    <ChartTable
      caption={caption}
      columns={["Period", ...plotted.map((entry) => entry.label)]}
      rows={buckets.map((bucket, index) => [
        bucket,
        ...plotted.map((entry) => formatCount(entry.points[index] ?? 0)),
      ])}
    />
  );

  if (plotted.length === 0 || buckets.length < 2) {
    return (
      <div className={className}>
        <NoData message="Not enough history to plot yet" />
        {table}
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      <Chart
        definition={definition}
        height={144}
        initialWidth={640}
        ariaLabel={caption}
        ariaDescription="Use the arrow keys to inspect each period. Exact values also appear in the data table."
        className="text-text-muted [&_text]:font-mono [&_text]:text-[10px] [&_text]:tabular-nums"
      />

      <div className="mt-1 flex justify-between pl-9 text-[10px] text-text-muted">
        <span>{buckets[0]}</span>
        <span>{buckets[buckets.length - 1]}</span>
      </div>

      {/* A legend for two or more series, always. One series needs none — the
          card's title already says what is plotted. */}
      {plotted.length < 2 ? null : (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-9">
          {plotted.map((entry) => (
            <li
              key={entry.key}
              className="flex items-center gap-1.5 text-[11px]"
            >
              <span
                aria-hidden
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ background: paint(entry.color) }}
              />
              <span className="text-text-muted">{entry.label}</span>
            </li>
          ))}
        </ul>
      )}

      {table}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bar list                                                                   */
/* -------------------------------------------------------------------------- */

export interface BarListItem extends ChartDatum {
  /** Rendered after the label, for a reference or a kind. */
  meta?: ReactNode;
  onSelect?: () => void;
}

export interface BarListProps {
  items: readonly BarListItem[];
  caption: string;
  /** Overrides the scale maximum, to compare two lists against one axis. */
  max?: number;
  className?: string;
}

/**
 * Ranked magnitude.
 *
 * Every bar takes the same colour unless the caller says otherwise. Shading
 * each one darker-where-bigger would encode the value twice — once as length,
 * once as hue — and spend the identity channel on nothing.
 */
export function BarList({
  items,
  caption,
  max,
  className,
}: BarListProps): React.JSX.Element {
  const ceiling = Math.max(max ?? 0, ...items.map((item) => item.value), 1);

  if (items.length === 0) {
    return (
      <div className={className}>
        <NoData />
        <ChartTable caption={caption} columns={["Item", "Count"]} rows={[]} />
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const row = (
            <>
              <span
                className="w-40 shrink-0 truncate text-[12px]"
                title={item.label}
              >
                {item.label}
              </span>
              {item.meta === undefined ? null : (
                <span className="w-20 shrink-0 truncate text-[11px] text-text-muted">
                  {item.meta}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span
                  className="block h-2 rounded-r-[2px]"
                  style={{
                    width: barWidth(item.value, ceiling),
                    background: paint(item.color),
                  }}
                />
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums">
                {formatCount(item.value)}
              </span>
            </>
          );

          return (
            <li key={item.key}>
              {item.onSelect === undefined ? (
                <span className="flex items-center gap-2">{row}</span>
              ) : (
                <button
                  type="button"
                  onClick={item.onSelect}
                  className="flex w-full items-center gap-2 rounded-(--cv-radius) text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {row}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <ChartTable
        caption={caption}
        columns={["Item", "Count"]}
        rows={items.map((item) => [item.label, formatCount(item.value)])}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stage bar                                                                  */
/* -------------------------------------------------------------------------- */

export interface StageDatum {
  key: string;
  label: string;
  p50Days: number | null;
  p90Days: number | null;
  sampleSize: number;
  color?: string;
}

export interface StageBarProps {
  stages: readonly StageDatum[];
  caption: string;
  className?: string;
}

/**
 * How long each stage takes.
 *
 * The sample size is printed beside every stage and is never hidden. A median
 * over two cases is a median over two cases; a chart that omits that invites
 * someone to quote it in a vendor report as if it were a rate.
 */
export function StageBar({
  stages,
  caption,
  className,
}: StageBarProps): React.JSX.Element {
  const ceiling = Math.max(
    1,
    ...stages.map((stage) => stage.p90Days ?? stage.p50Days ?? 0),
  );

  const measured = stages.filter((stage) => stage.p50Days !== null);

  const table = (
    <ChartTable
      caption={caption}
      columns={["Stage", "Median days", "90th percentile days", "Sample size"]}
      rows={stages.map((stage) => [
        stage.label,
        stage.p50Days === null ? "—" : stage.p50Days.toFixed(1),
        stage.p90Days === null ? "—" : stage.p90Days.toFixed(1),
        String(stage.sampleSize),
      ])}
    />
  );

  if (measured.length === 0) {
    return (
      <div className={className}>
        <NoData message="No completed disclosure stages yet" />
        {table}
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      <ul className="flex flex-col gap-2">
        {stages.map((stage) => (
          <li key={stage.key} className="flex flex-col gap-0.5">
            <span className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="truncate text-text-muted">{stage.label}</span>
              <span className="shrink-0 font-mono tabular-nums">
                {stage.p50Days === null ? "—" : `${stage.p50Days.toFixed(0)}d`}
                <span className="ml-1.5 text-text-muted">
                  n={stage.sampleSize}
                </span>
              </span>
            </span>

            <span className="relative block h-2 w-full rounded-[2px] bg-surface-raised">
              {stage.p90Days === null ? null : (
                <span
                  aria-hidden
                  title={`90th percentile: ${stage.p90Days.toFixed(0)} days`}
                  className="absolute inset-y-0 left-0 rounded-[2px] opacity-30"
                  style={{
                    width: `${percentage(stage.p90Days, ceiling)}%`,
                    background: paint(stage.color),
                  }}
                />
              )}
              {stage.p50Days === null ? null : (
                <span
                  aria-hidden
                  title={`Median: ${stage.p50Days.toFixed(0)} days`}
                  className="absolute inset-y-0 left-0 rounded-[2px]"
                  style={{
                    width: barWidth(stage.p50Days, ceiling),
                    background: paint(stage.color),
                  }}
                />
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px] text-text-muted">
        Solid bar is the median; the paler extent is the 90th percentile.
      </p>

      {table}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Funnel                                                                     */
/* -------------------------------------------------------------------------- */

export interface FunnelStep {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export interface FunnelProps {
  steps: readonly FunnelStep[];
  caption: string;
  className?: string;
}

/**
 * An ordered pipeline.
 *
 * Ordinal rather than categorical: the steps have a sequence, so the colour
 * ramp carries that sequence and the reader sees the order without reading the
 * labels. Each row states what reached it, in absolute terms rather than as a
 * conversion rate off the previous step — research is not a one-way pipeline
 * and a finding can move backwards.
 */
export function Funnel({
  steps,
  caption,
  className,
}: FunnelProps): React.JSX.Element {
  const ceiling = Math.max(1, ...steps.map((step) => step.value));
  const total = steps.reduce((sum, step) => sum + step.value, 0);

  const table = (
    <ChartTable
      caption={caption}
      columns={["Stage", "Findings", "Share of widest stage"]}
      rows={steps.map((step) => [
        step.label,
        formatCount(step.value),
        `${percentage(step.value, ceiling).toFixed(1)}%`,
      ])}
    />
  );

  if (total === 0) {
    return (
      <div className={className}>
        <NoData />
        {table}
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      <ul className="flex flex-col gap-1">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className="w-28 shrink-0 truncate text-[12px]"
              title={step.label}
            >
              {step.label}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block h-3 rounded-r-[2px]"
                style={{
                  width: barWidth(step.value, ceiling),
                  background: paint(step.color),
                }}
              />
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums">
              {formatCount(step.value)}
            </span>
          </li>
        ))}
      </ul>

      {table}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Meter                                                                      */
/* -------------------------------------------------------------------------- */

export interface MeterProps {
  label: string;
  value: number;
  total: number;
  /** Below this share the fill switches to the warning colour. */
  warnBelow?: number;
  className?: string;
}

/**
 * A single ratio against its whole.
 *
 * The unfilled track is a lighter step of the same surface rather than a second
 * hue, so the state reads across the whole bar instead of looking like two
 * competing series.
 */
export function Meter({
  label,
  value,
  total,
  warnBelow = 0.6,
  className,
}: MeterProps): React.JSX.Element {
  const share = total <= 0 ? 0 : value / total;
  const healthy = share >= warnBelow;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="truncate text-text-muted">{label}</span>
        <span className="shrink-0 font-mono tabular-nums">
          {formatCount(value)}/{formatCount(total)}
          <span className="ml-1.5 text-text-muted">
            {(share * 100).toFixed(0)}%
          </span>
        </span>
      </span>

      <span
        className="block h-2 w-full rounded-[2px] bg-surface-raised"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label}
      >
        <span
          className="block h-full rounded-[2px]"
          style={{
            width: `${percentage(value, total)}%`,
            background: healthy ? "var(--cv-success)" : "var(--cv-warning)",
          }}
        />
      </span>
    </div>
  );
}
