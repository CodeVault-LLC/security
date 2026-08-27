---
name: CodeVault Security
description: A precise, editor-like workbench for vulnerability research and coordinated disclosure.
colors:
  action-blue: "oklch(52% 0.16 255)"
  action-blue-hover: "oklch(46% 0.17 255)"
  focus-blue: "oklch(60% 0.18 255)"
  workspace-canvas: "oklch(98.2% 0.003 250)"
  working-surface: "oklch(100% 0 0)"
  raised-surface: "oklch(96.8% 0.004 250)"
  hover-surface: "oklch(94.8% 0.006 250)"
  quiet-border: "oklch(88.5% 0.007 250)"
  strong-border: "oklch(74% 0.01 250)"
  primary-text: "oklch(22% 0.01 250)"
  muted-text: "oklch(52% 0.012 250)"
  success: "oklch(52% 0.13 155)"
  warning: "oklch(62% 0.14 75)"
  danger: "oklch(53% 0.19 27)"
typography:
  headline:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  section:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.25
  metadata:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.45
  micro:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.25
  editor:
    fontFamily: "Lilex, Geist Mono Variable, ui-monospace, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.618
rounded:
  hairline-grip: "2px"
  scrollbar-thumb: "3px"
  control: "6px"
  container: "8px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.working-surface}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.working-surface}"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  input:
    backgroundColor: "{colors.working-surface}"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.working-surface}"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.container}"
    padding: "12px"
  status-badge:
    backgroundColor: "{colors.raised-surface}"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.pill}"
    padding: "0 6px"
    height: "20px"
---

# Design System: CodeVault Security

## Overview

**Creative North Star: "The Research Workbench"**

CodeVault Security should feel like a calm professional editor built around sensitive, high-consequence records. The interface keeps navigation and utilities available at the edges while giving the active record or action queue the largest, clearest surface.

The visual system is dense without becoming cramped: cool neutral layers, thin structural borders, restrained blue actions, compact controls, and exact typography. Decoration stays subordinate to evidence, state, ownership, timing, and the next permitted action.

**Key Characteristics:**

- Editor-like navigation with persistent, keyboard-accessible resizing and collapse.
- Action-first hierarchy with one explicit primary action in the first viewport.
- Cool neutral surfaces with a rare blue accent and semantic status colors.
- Compact, aligned controls and status signals that remain legible in dense lists.
- Progressive disclosure for secondary analysis and advanced editing controls.

## Colors

The palette uses cool paper-like neutrals for structure and a single confident blue for actions, selection, focus, and product identity. Semantic colors always retain text or icon labels.

### Primary

- **Action Blue:** Reserved for the current primary action, active icon, focus affordance, and selected emphasis.

### Neutral

- **Workspace Canvas:** The quiet application background behind working surfaces.
- **Working Surface:** Cards, toolbars, dialogs, and editor panes.
- **Raised Surface:** Selected navigation, disabled fields, and nested controls.
- **Quiet Border:** Default separators and container outlines.
- **Primary Text / Muted Text:** Primary content and supporting metadata respectively.

### Named Rules

**The One Action Rule.** Use blue for the single clearest executable action in a local decision area; keep neighboring utilities neutral.

**The Meaning Survives Color Rule.** Severity, connection, validation, and permission states always include text, an icon, or both.

## Typography

**Display Font:** Geist Variable (system sans-serif fallback)  
**Body Font:** Geist Variable (system sans-serif fallback)  
**Label/Mono Font:** Geist Mono Variable; Lilex for long-form editor buffers

**Character:** Geist keeps dense application chrome quiet and exact. Lilex gives report writing a distinct, comfortable reading rhythm without making the editor feel like a separate product.

### Hierarchy

- **Headline** (600, 19px, 1.25): Route titles only.
- **Section** (600, 18px, 1.3): Active-record titles within a route.
- **Title** (600, 14px, 1.4): Cards, dialogs, and discrete regions.
- **Body** (400, 13px, 1.5): Primary interface copy and record content.
- **Label** (500, 12px, 1.25): Controls, metadata, and compact navigation.
- **Metadata** (400, 11px, 1.45): Helper text, policy consequences, dates, and dense row state.
- **Micro** (500, 10–10.5px, 1.25): Section overlines and exceptionally dense system labels only.
- **Editor** (400, 15px, 1.618): Markdown and report-writing buffers.

**The Hierarchy Before Size Rule.** Prefer weight, placement, and muted color before introducing a new font size.

## Layout

The application is a workbench: a persistent navigation panel, a narrow resize seam, and a flexible workspace. The navigation width persists locally between sessions, is draggable and keyboard-adjustable, and can be removed entirely from the global toolbar. At 1100px and below it becomes a 56px icon rail; native macOS title-bar controls retain a safe area and rail branding is omitted because the toolbar already names the product.

The global toolbar is 44px high. Page headers use at least 72px and separate context from scrollable content. Standard page padding is 20px; dense component interiors use an 8/12/16px rhythm. At compact widths, preserve the primary record and action rather than squeezing every auxiliary panel into view.

**The Content Owns the Center Rule.** Navigation and utilities may resize or collapse; the active research record must not.

## Elevation & Depth

The system is flat by default. Tonal layering and borders carry structure; cards use only a 1px/2px ambient shadow, while primary actions may use a restrained small shadow. Dialog overlays create the strongest depth break.

**The Structural Depth Rule.** Use borders and surface changes for persistent hierarchy; reserve stronger shadow for overlays or the current primary action.

## Shapes

Controls use gently curved 6px corners and containers use 8px corners. Fully rounded pills belong only to statuses, severities, and compact count-like metadata. Dividers stay thin; the resizable seam adds a small centered grip so its affordance is visible at rest.

## Components

### Buttons

- **Shape:** Compact rectangular controls with 6px corners; standard height is 36px, with 32px small and 40px large variants.
- **Primary:** Action Blue with high-contrast text and a restrained shadow. Label the consequence directly.
- **Hover / Focus:** Darken the fill on hover; use a visible blue two-pixel focus outline. Press feedback is brief and disabled during loading.
- **Secondary / Ghost / Danger:** White or transparent surfaces with explicit borders or semantic text. Disabled controls remain visible with reduced opacity, disabled surface treatment, and a not-allowed cursor.

### Tabs

- **Active state:** Use a two-pixel Action Blue underline inset from the label edges. Do not turn tabs into filled pills or repeat the active state with a second background treatment.
- **Density:** Tab rows are 40px high, horizontally scroll when needed, and keep labels on one line. Counts may follow the label as plain text.
- **Hierarchy:** Tabs switch views within the current record. Use links or sidebar navigation when the destination changes the record or route context.

### Mail workspaces

- Keep the folder rail, conversation list, and reader stable while data refreshes. Initial loads use structural skeletons; background refreshes use a thin indeterminate progress edge.
- Read state and provider categories are filters on the current mailbox, not organization-wide settings. Keep them visible above the list and clear the selected conversation when it no longer belongs to the active slice.
- Attachments are explicit secondary actions. Bytes move through the bounded desktop bridge and a native save picker; the renderer never receives a filesystem path.

### Analytical signals

- Derived metrics must state their basis in nearby text. Prefer ratios, percentile spreads, and aging shares with visible numerators and denominators over opaque composite scores.
- Put operational signals before detailed distributions so the page first answers where work is accumulating, then supplies the underlying breakdowns.

### Chips

- **Style:** 20px status pills with 11px text, an outline, and a text/icon label. Never use pills for ordinary actions.

### Cards / Containers

- **Corner Style:** Gently curved 8px corners.
- **Background:** Working Surface over Workspace Canvas.
- **Shadow Strategy:** Near-flat ambient shadow only.
- **Border:** Quiet Border by default; Strong Border for the current priority region.
- **Internal Padding:** 12–14px for headers and rows, 20px between page regions.

### Inputs / Fields

- **Style:** 36px high, 6px corners, quiet border, working-surface fill, and 13px text.
- **Focus:** Focus Blue border and two-pixel outline.
- **Error / Disabled:** Semantic border plus inline `FieldError`; disabled fields use Raised Surface and remain readable. Helper text uses `FieldDescription` at 11.5px and is connected with `aria-describedby`.

### Settings Workspaces

- **Navigation:** Personal Settings and Organization use the shared settings shell. Each has one persistent local sidebar on wide layouts and one horizontally scrollable link row on compact layouts. These links change routes, so they are navigation rather than record tabs.
- **Organization scope:** The global sidebar has one Organization destination. The Organization sidebar owns Members, General, and Security & access, and stays visible on member detail pages.
- **Active state:** The current settings link uses a blue icon and selected surface at every width. `aria-current="page"` must name the same state without color. Do not style route links as record tabs.
- **Page hierarchy:** Name the settings area once in the local sidebar and the current section once in the content header. Do not repeat the page title as the first card title.
- **Sections:** Use a top divider, 24px vertical padding, and the standard Title, Body, and Metadata type steps. Cards are reserved for independently loaded or independently saved regions, not every group of fields.
- **Fixed choices:** Two or three static role or preference choices stay visible as radio or segmented controls. Use Select only for longer or dynamic option sets.
- **Shared controls:** Settings use the shared Button, Input, Select, Checkbox, loading, error, and save-state components. Do not override their standard heights or radii inside a settings route.
- **Policy Rows:** Put the requirement name and consequence on the left and its direct control, unit, or immutable state on the right. Use a section divider instead of wrapping every value in a separate card.
- **Save State:** Each independently persisted policy surface owns one save bar. Reset remains neutral; Save becomes blue only when changes are valid and executable.
- **Scope and Permissions:** Name organization-wide consequences inline. Required, optional, enabled, blocked, read-only, loading, invalid, unsaved, saving, saved, and failure states must remain visible without relying on disabled styling alone.
- **Reversible Requirements:** Preserve enrolled security credentials when an administrator relaxes a requirement, and explain any session revocation before a stricter policy is saved.
- **Advanced Controls:** Keep common requirements visible and place provider isolation, cost limits, and configuration-source allow-lists behind progressive disclosure.

### Navigation

Navigation uses 36px rows, muted default labels, a tonal hover, and a raised selected surface with a blue icon. It is resizable above 1100px, an icon rail below that breakpoint, and fully collapsible from the global toolbar. Every icon-only item has an accessible name and tooltip.

### Resizable Workspace

The seam has a nine-pixel pointer target, a visible centered grip, a blue hover/focus state, arrow/Home/End keyboard controls, double-click reset, and persisted width. Hiding a handle at a responsive breakpoint must not collapse the workspace grid.

## Do's and Don'ts

### Do:

- **Do** place the next permitted action beside the record that needs it and name the consequence.
- **Do** keep helper, validation, loading, offline, and disabled states explicit.
- **Do** use progressive disclosure for secondary metrics and advanced editor controls.
- **Do** preserve long identifiers, keyboard navigation, and meaning in grayscale.

### Don't:

- **Don't** use decorative gradients, oversized branding, or competing accent actions in application chrome.
- **Don't** repeat activity detail when it says the same thing as the title.
- **Don't** reduce timestamps to cryptic narrow-unit notation.
- **Don't** place macOS window controls over branding or interactive controls.
- **Don't** infer permission or executability from color alone.
