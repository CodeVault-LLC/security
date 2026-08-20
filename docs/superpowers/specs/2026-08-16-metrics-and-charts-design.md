# Metrics and charts

**Date:** 2026-08-16
**Status:** Implemented. The chart primitives, contracts, API, dashboard,
assets views, and Metrics destination are in the repository. Acceptance lives
in `packages/ui/src/components/charts.test.tsx` and
`apps/server/src/modules/metrics/routes.integration.test.ts`.

Adds quantitative visualisation to CodeVault: a chart primitive layer in
`@codevault/ui`, a metrics API, charts leading the dashboard, aggregate views on
the asset pages, and a dedicated Metrics destination.

---

## 1. Motivation and the rule this overrides

The product currently shows no aggregate quantity anywhere. Severity totals
render as six bare integers at the bottom of the dashboard; the assets list is a
flat table with a per-row finding count and no roll-up at all. A researcher
cannot answer "is my intake accelerating?", "which bug class do I keep finding?"
or "how long do vendors actually take to acknowledge?" without writing SQL.

This deliberately overrides two previously stated rules:

- Plan §24: *"The dashboard is operational, not a severity pie-chart
  collection"* and *"Severity totals can exist as a secondary compact widget,
  never the primary dashboard."* Charts now lead the dashboard, with the
  operational lists below them.
- `app-sidebar.tsx`: *"Nine destinations, not one per database table."* Metrics
  is a tenth.

Both documents are updated as part of this work. The rules were not wrong when
written — they guarded against a generic admin console — but the guard is the
*form*, not the absence of quantity. Dense inline visualisation against a
restrained palette is what the plan's own §11 asks for; a wall of donuts is what
it forbids. Nothing here adds a marketing card, a gradient, or a vanity metric.

## 2. Architecture

Four new units, each with one purpose and a boundary that can be understood
without reading the others.

| Unit | Path | Depends on |
|---|---|---|
| Chart primitives | `packages/ui/src/components/charts.tsx` | `cn`, CSS tokens |
| Metrics contracts | `packages/contracts/src/metrics.ts` | `common.js` |
| Metrics API | `apps/server/src/modules/metrics/routes.ts` | contracts, `readableCaseIdsSubquery` |
| Metrics page | `apps/desktop/src/renderer/src/routes/metrics.tsx` | `@codevault/ui`, `lib/api` |

The chart layer knows nothing about security. It takes numbers and labels and
returns SVG. Every domain decision — that critical is red, that a funnel runs
Draft→Confirmed — lives in feature code or in tokens, never inside a chart
component. This is what allows the charts to be tested with arbitrary numbers
and reused on any of the four surfaces.

## 3. Chart primitives

Six components, no third-party dependency. A charting library was considered and
rejected: Recharts brings ~500KB and a theming model that cannot read the OKLCH
custom properties without a shim, and its default styling is the generic-admin
look §11 explicitly rules out. visx would still require writing each chart by
hand. The charts here are small, and hand-rolled SVG keeps them honest against
the token system.

```
StatTile    label, value, delta?, trend?     KPI rows
StackedBar  segments[]                        part-to-whole, ≤6 segments
TrendChart  series[], buckets[]               change over time
BarList     items[]                           ranked magnitude
StageBar    stages[]                          durations with p50/p90
Funnel      steps[]                           ordered pipeline with drop-off
```

### Shared contract

Every component:

- Renders one `<svg>` with a `viewBox` and no fixed pixel height, so it scales
  with its card. The container is sized to include the axis band — a fixed
  height that excludes axis labels produces a nested scrollbar.
- Takes colour as a CSS custom-property *name*, never a hex value. Callers pass
  `"--cv-severity-critical"`; the component writes
  `fill="var(--cv-severity-critical)"`. Light and dark then follow the existing
  `:root[data-theme]` switch with no second palette to maintain.
- Renders a visually-hidden `<table>` carrying every plotted value. This is the
  table-view twin that keeps values reachable when colour is not, and it is what
  the unit tests assert against — asserting on SVG path geometry would be
  brittle and would not prove the numbers are right.
- Handles three degenerate inputs explicitly: no data, one data point, and all
  values zero. Each renders a labelled empty state rather than a division by
  zero or a zero-height bar.

### Mark specification

Fixed across all six, per the house style and the dataviz rules:

- Bars capped at 24px thick, 4px rounded data-end, square at the baseline.
- Lines 2px, round join and cap. Markers r ≥ 4 with a 2px surface ring.
- Area fills at ~10% opacity — a wash, never a saturated block.
- Gridlines and axes: hairline, solid, one step off surface. Never dashed.
- **A 2px gap in the surface colour separates touching marks** — every stacked
  segment and every adjacent bar. Never a stroke drawn around a mark.
- Text wears text tokens (`text-text`, `text-text-muted`), never the series
  colour. A label set inside a filled segment is the sole exception and picks
  ink or white by the fill's luminance.
- Values use `tabular-nums` in table rows and axis ticks; stat-tile values use
  proportional figures, since equal-width digits look loose at display size.

### Labelling rule

Labels are placed inside a mark only when the rendered text fits with padding on
both sides, measured before placement. When it does not fit, the label moves
outside the bar end, or is dropped to the legend and table for an interior
stacked segment which has no free end. `overflow: hidden` is never used to
"solve" a too-long label — cropping characters is worse than omitting the label,
and the value is never lost because the table twin always carries it.

## 4. Colour

Three of the four colour jobs appear; none of them is nominal-categorical with
many series, so no eight-hue categorical palette is introduced.

| Chart | Job | Source |
|---|---|---|
| Severity mix | status (reserved scale) | `--cv-severity-*` |
| Validation funnel, disclosure posture | ordinal | accent hue, monotone lightness |
| Time-to-X stages | ordinal | accent hue |
| CWE list, top assets, findings by kind | nominal, single series | `--cv-accent` for every bar |
| Intake trend | single series | `--cv-accent` |
| Novelty | status-like, 3 classes | `--cv-success` / `--cv-warning` / `--cv-text-muted` |

Nominal categories take **one** colour for every bar. Colouring each bar
darker-where-bigger would double-encode bar length as hue and spend the identity
channel on information the length already carries.

### The severity adjacency finding

The severity tokens were validated rather than assumed. Measured with the
Machado–Oliveira–Fernandes 2009 CVD model, ΔE in OKLab ×100:

| Pair | Normal vision | Worst CVD | Floor |
|---|---|---|---|
| critical ↔ high, light | 8.4 | 8.3 deutan | 15 |
| critical ↔ high, dark | 8.8 | 6.1 deutan | 15 |

`--cv-severity-critical` and `--cv-severity-high` are reds roughly twelve degrees
of hue apart. Today they always appear separated and labelled, so the proximity
never bites. In a stacked bar they physically touch, which is the case the floor
exists for.

**Decision: the tokens are left unchanged.** They paint every badge, finding
header, report and PDF export, and re-stepping them to widen the gap is a
product-wide visual change outside the scope of adding graphs. A re-step to
`oklch(38% .20 15)` / `oklch(58% .20 42)` was measured and reaches ΔE 18.0 light
and 17.6 dark; it is recorded here should the tokens be revisited.

The mitigation is therefore mandatory secondary encoding wherever severity
segments touch, and it is not optional decoration — it is what makes the chart
legible:

1. A legend is always present, listing every severity with its count.
2. Direct labels ride each segment wide enough to hold one.
3. The 2px surface gap separates adjacent segments.
4. The hidden table twin carries every value.

`StackedBar` enforces this by requiring a `legend` prop when `segments.length >
1` — the type system, not a convention, is what keeps a future caller from
shipping colour-only severity.

Other checks on the severity scale — that it spans the lightness band, and that
`none` sits below the chroma floor — are expected of an ordinal heat scale and
of a grey that deliberately means "no severity". They are not defects and are not
"fixed".

## 5. Metrics API

### Endpoints

```
GET /v1/metrics?window=30d|90d|365d|all     workspace-wide
GET /v1/metrics/assets                       asset roll-ups
GET /v1/assets/:assetId/metrics              one asset
```

All three scope through `readableCaseIdsSubquery(user.id)`, the same subquery the
dashboard and findings modules use. This is the single most important property
of this module: an aggregate is an information leak if it counts rows the caller
cannot read. The integration tests assert it directly.

`window` selects the trend and time-to-X range and defaults to `90d`.
Distribution metrics — severity, validation, disclosure, novelty — always report
current totals and ignore the window, because "how many findings are critical
right now" is not a windowed question. The page states this next to the control
so the two behaviours are not mistaken for a bug.

### Queries

Each maps to columns that exist today; the indices named are already defined in
`packages/db/src/schema/findings.ts`.

| Metric | Source | Index |
|---|---|---|
| Severity distribution | `findings.severity` | `findings_severity_idx` |
| Validation funnel | `findings.validation_state` | `findings_validation_idx` |
| Disclosure posture | `findings.disclosure_state` | `findings_disclosure_idx` |
| Novelty | `findings.prior_art_state` | `findings_prior_art_idx` |
| Intake over time | `date_trunc(bucket, findings.created_at)` | — |
| CWE classes | `jsonb_array_elements_text(findings.cwe_ids)` | — |
| Time-to-X | paired `disclosure_events.occurred_at` | `disclosure_events_case_idx` |
| Top affected assets | `finding_assets` ⋈ `findings` | `finding_assets_asset_idx` |
| Identifier coverage | `asset_identifiers` left join | — |

Two details that are easy to get wrong:

- **Gap filling.** Intake is `LEFT JOIN`ed against `generate_series` over the
  window so a week with no findings emits a zero rather than being absent. A
  missing bucket makes a line chart lie by connecting across the gap.
- **Percentiles.** Time-to-X uses `percentile_cont(0.5)` and `(0.9)` within
  group, computed per case over paired events (`DISCOVERED`→`VENDOR_CONTACTED`,
  `VENDOR_CONTACTED`→`VENDOR_ACKNOWLEDGED`,
  `VENDOR_ACKNOWLEDGED`→`PATCH_VERIFIED`). Cases missing either end of a pair are
  excluded from that stage, and each stage reports its own sample size. A median
  over four cases is reported as `n=4`, not presented as a fact. The API always
  returns `n`; the dashboard KPI tile, which has no room to show it, renders "—"
  below `n=3` instead.

### Bucket granularity

`30d` buckets daily, `90d` and `365d` weekly, `all` monthly. Chosen so a trend
never renders more than ~52 points, which is the density at which a 2px line in
a dashboard-sized card stops being readable.

## 6. Layout

### Dashboard

```
┌─ KPI row ─────────────────────────────────────────────────────┐
│ Open findings   Criticals unfixed   Open cases   Median ack   │
└───────────────────────────────────────────────────────────────┘
┌─ Severity mix ──┐ ┌─ Intake (90d) ──┐ ┌─ Disclosure posture ──┐
└─────────────────┘ └─────────────────┘ └───────────────────────┘
┌─ Needs attention ──────────┐ ┌─ What changed ───────────────┐
└────────────────────────────┘ └──────────────────────────────┘
```

"Median ack" is the median of `VENDOR_CONTACTED`→`VENDOR_ACKNOWLEDGED` across
cases in the window — the same stage-two figure the Metrics page reports, shown
here because vendor responsiveness is the number a coordinated-disclosure
researcher checks most often. It renders as "—" when fewer than three cases have
both events, rather than presenting a median over one case as a trend.

The KPI row is stat tiles, not a hero figure. A hero is for a view with one
headline number; this view has four peers, and inflating one of them to 48px
would assert a priority the data does not have.

`Needs attention` and `What changed` keep their current markup and behaviour
unchanged — they move down, they are not rewritten.

### Assets index

A strip above the existing list: findings by asset kind, top assets by open
finding count (severity-composed), and identifier coverage as a meter. The
existing filter row and table are untouched.

Identifier coverage is included because it is actionable rather than decorative:
prior-art matching accuracy depends on a PURL or CPE, as the empty state on the
asset detail page already tells the user. "41% of assets carry no identifier" is
a specific piece of work, not a vanity number.

### Asset detail

A fourth card joining Identifiers, Versions and Relationships: severity mix for
this asset, a finding-activity sparkline, and affected-version verification
status. The verification metric pairs with the existing
`STALE_AFFECTED_VERSIONS` attention item, so the dashboard alert and the asset
page agree about what is unverified.

### Metrics page

One filter row above everything, scoping every chart on the page together.
Per-chart filters are not used — a row of controls scattered through the cards
makes it impossible to know what slice is being compared.

```
[ 30d | 90d | 365d | All ]

KPI row      Findings   Confirmed   Public   Median ack   Novelty rate
Trend        Opened vs published over time            (2 series, legend)
Severity     Stacked bar + counts
Funnel       Draft → Reproduced → Peer reviewed → Confirmed
Time-to-X    Stage bars, p50 and p90, each with n
Classes      Top 10 CWE + Other
Novelty      Novel / known / unchecked
Assets       Top affected, severity-composed
```

## 7. Loading, error and empty behaviour

Refetch holds the previous render at reduced opacity rather than dropping to a
skeleton, so changing the time window does not make the page jump.

Errors surface through the existing `QueryBoundary` / `ErrorState` path. A chart
whose query failed renders an error, never an empty chart — a zero-height bar
chart and a failed request look identical, and in this product that difference
matters. This is the same reasoning already recorded on `ErrorState`.

A genuinely empty workspace renders `EmptyState` per card, not axes around
nothing.

## 8. Testing

`packages/ui/src/components/charts.test.tsx`

- Each component renders its table twin with every value passed in.
- No data, one data point, and all-zero values each render an empty state.
- `StackedBar` renders a legend entry per segment with counts.
- A label too long for its segment is absent from the mark and present in the
  table, and is never truncated with an ellipsis inside the segment.

`apps/server/src/modules/metrics/routes.integration.test.ts`

- **Scope isolation:** a user who cannot read a case sees none of its findings in
  any metric. Asserted per metric, not once.
- Window boundaries: a finding created exactly at the window edge falls on the
  expected side.
- Gap filling: a window containing an empty week returns a zero bucket for it.
- Time-to-X excludes cases missing either end of a pair and reports the correct
  `n`.
- An empty database returns zeroes and empty arrays, never null.

These follow the existing integration-test patterns in
`apps/server/src/*.integration.test.ts`.

## 9. Wiring

- `packages/ui/src/index.ts` re-exports `./components/charts.js`.
- `packages/contracts/src/index.ts` re-exports `./metrics.js`.
- `apps/server/src/routes.ts` calls `registerMetricsRoutes(app)`.
- `lib/api.ts` gains `queryKeys.metrics(filters?)` and
  `queryKeys.assetMetrics(id)`.
- `lib/events.ts` adds `invalidate(["metrics"])` beside the existing
  `invalidate(queryKeys.dashboard)`, so SSE keeps charts live.
- `router.tsx` adds `/metrics`; `app-sidebar.tsx` adds the entry next to
  Activity.

## 10. Documentation to update

- `docs/superpowers/plans/2026-08-15-codevault-security-research-platform.md`
  §24 — restate what the dashboard leads with, and why quantity is now allowed.
- `apps/desktop/src/renderer/src/components/app-sidebar.tsx` — the "Nine
  destinations" comment becomes ten, with the reason.
- `packages/ui/src/tokens.css` — record the measured critical/high adjacency and
  the requirement that severity fills carry a legend, so the next person to
  touch severity colours knows the constraint exists.

## 11. Explicitly out of scope

- Changing the severity tokens (measured and recorded in §4; deferred).
- CSV or image export of charts.
- User-configurable dashboards or a widget builder — the plan's non-goals list
  rules out a "generic dashboard/widget builder" and nothing here reopens it.
- Cross-workspace or multi-tenant comparison.
- Any derived composite "risk score". The plan's scoring principles forbid
  multiplying unrelated metrics into a "proprietary CodeVault risk number", and
  no chart here does. Severity, EPSS and KEV stay separate signals throughout.
