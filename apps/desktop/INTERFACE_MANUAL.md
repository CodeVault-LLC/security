# CodeVault Security interface manual

This manual defines how the desktop interface organizes attention. Use it with
`PRODUCT.md` and `DESIGN.md`. Those files define the product and visual system;
this file defines hierarchy, navigation, and interaction behavior.

## Product job

CodeVault Security helps a researcher turn technical evidence into a complete,
scored, reviewable disclosure while keeping cases, assets, vendors, and reports
connected to that work.

The interface must serve three levels of experience:

- A beginner can identify the next useful action without learning internal
  terminology first.
- A regular user can move between records without repeatedly reorienting.
- An expert can work primarily through the keyboard and keep the content area
  large.

## Attention model

Every screen has one primary surface. Everything else supports it.

1. The primary surface receives the most space and the strongest visual weight.
2. Context needed for the current decision stays visible.
3. Context needed occasionally stays one action away in a tab, menu, sheet, or
   collapsible region.
4. Global utilities never compete with record content.

Do not solve placement by adding another persistent panel. First decide whether
the information belongs to the global shell, the current record, the current
task, or an on-demand utility.

## Application hierarchy

The interface has three stable layers.

### Global shell

The global shell contains only navigation, location, and workspace-wide
utilities.

- Use a compact icon rail by default. Each icon has a tooltip and an accessible
  label. The user can expand the rail when labels are helpful.
- Keep the rail narrow enough that it never becomes a competing work surface.
- Put the account menu in a single compact control at the bottom of the rail.
  Do not separate the avatar and name with unused space.
- Use a 44-pixel location bar above route content.
- Make every breadcrumb ancestor a link. `CodeVault Security` always opens Home.
- Do not show `Live`, `Online`, or `Offline` in the location bar. Connectivity is
  background state. Show a compact warning only when a failure requires a user
  decision or makes displayed data unreliable.
- Keep search available as an icon and keyboard shortcut.

### Collection

A collection helps the user find and open a record.

- Use one compact page heading. Do not repeat the same title in the location bar,
  page header, and table container.
- Keep search and the most common filters visible. Put advanced filters behind a
  filter control.
- Use the same pagination behavior for Cases, Findings, Assets, and Vendors.
- Preserve query, filters, sort, and page in the URL when practical.
- Keep row density suitable for scanning. Use a table or structured list before
  a card grid when records share comparable fields.
- Empty, loading, filtered-empty, error, and partial-data states must preserve
  the collection frame so the user does not lose their place.

### Record workspace

A record workspace gives the object a stable identity and changes only the work
surface below it.

- Use one compact identity row for the record name, state, and the one primary
  action, if one exists.
- Place compact horizontal tabs directly below the identity row. Tabs describe
  destinations, not actions. They use the product's restrained visual language,
  inspired by dense analysis tools rather than oversized pills.
- Keep the tab order stable. Preserve the active tab in the URL.
- Avoid a second sidebar inside the record unless it is an optional outline for
  the primary document.
- Use sheets for metadata or tools that are useful during work but do not need to
  remain visible.

## Finding workspace

The Finding workspace prioritizes writing and scoring.

### Overview

Overview contains the complete finding document in one editor buffer. Sections
such as Summary, Description, Impact, Steps to reproduce, Remediation, and
References are Markdown headings within that document, not separate editors.

- The editor occupies the available width and height.
- Do not place a persistent toolbar above `Write` and `Preview` tabs.
- Use small icon controls for document outline, preview, formatting, and more
  actions. Every icon requires a tooltip.
- Preview is a mode, not a second permanent pane. A split view may be available
  as an explicit expert option, but never as the default.
- Use an optional document outline that can collapse completely.
- Autosave status is quiet and local to the editor. Show it only while saving,
  after an error, or briefly after a successful save.
- AI assistance belongs in an icon or command menu and opens on demand. It must
  never be the largest control on the page.

### Score

Score is a focused assessment surface.

- Start with the current severity, numeric score, scoring system, and completion
  state.
- Group inputs by the decisions a researcher makes, not by storage fields.
- Reveal uncommon environmental and temporal inputs progressively.
- Explain the effect of a changed metric next to that metric.
- Keep the final vector and copy action available without giving them primary
  visual weight.
- Preserve unsaved values when the user changes tabs accidentally.

### Supporting tabs

Evidence, Prior art, History, and related material remain first-class features,
but they are supporting workspaces. Each should expose a useful summary in its
tab label or content without adding persistent panels to Overview.

## Case workspace

Cases become the coordination center after a finding enters a disclosure flow.

- Put Overview, Findings, Disclosure, Reports, Correspondence, Evidence, and
  History in the stable record tab row.
- Overview answers: what is this case, what is its state, who owns the next
  action, and what is blocked?
- Disclosure and Reports must be reachable in one click from anywhere in the
  case. They should not be duplicated as large promotional actions throughout
  the interface.
- Show the next meaningful action near the case state. Move rare actions into an
  overflow menu.
- Keep timeline and audit history out of the primary workflow unless the current
  tab is History.

## Asset and Vendor workspaces

Assets and Vendors use the same record structure as Findings and Cases.

- Identity row: name, type or category, lifecycle state, and compact actions.
- Tabs: Overview first, followed by relationships and activity relevant to that
  record.
- Overview begins with the information used to recognize and assess the object.
- Related findings, cases, vendors, assets, and disclosures use scan-friendly
  lists with counts in tab labels where useful.
- Avoid dashboard-style cards that make ordinary fields appear equally
  important.

## Controls and component choices

Prefer existing `@codevault/ui` primitives and Shadcn-compatible composition.

| Need | Preferred component |
| --- | --- |
| Global navigation | Sidebar or compact icon rail |
| Location | Breadcrumb |
| Record destinations | Tabs |
| Collection navigation | Pagination |
| Rare actions | Dropdown menu |
| Supporting metadata | Sheet |
| Optional advanced fields | Collapsible |
| Mutually exclusive compact modes | Toggle group |
| Adjacent editor actions | Button group |
| Simultaneous comparison only | Resizable panels |
| Brief explanation for an icon | Tooltip |

Use resizable panels only when both surfaces must remain visible to complete the
task. Do not use them merely because two categories of information exist.

## Naming and copy

- Use the shortest familiar noun that preserves meaning: `Findings`, not
  `Finding management`.
- Name tabs for destinations and buttons for actions.
- Use sentence case.
- Do not repeat a title in adjacent interface regions.
- Explain consequences at the decision point. Do not add permanent help text for
  ordinary controls.
- Prefer `More actions` for an overflow menu and specific accessible labels for
  icon-only actions.

## Keyboard and accessibility

- Every pointer action must have a keyboard path.
- Focus follows the user's action and returns to the trigger when an overlay
  closes.
- Icon-only controls require an accessible name and tooltip.
- Tabs use tab semantics and arrow-key navigation.
- The compact rail must remain understandable at 200% zoom.
- Do not encode severity, state, or save status by color alone.
- Respect reduced motion and preserve visible focus treatment.

## Reachable states

Design and test these states for every changed surface:

- first load
- loading with existing data
- empty
- filtered empty
- partial data
- recoverable error
- permission denied
- unsaved changes
- saving
- save failed
- stale or disconnected data when the state affects correctness

State changes must preserve the user's mental model. A failed action should not
discard input, change tabs, close the record, or reset the collection page.

## Prohibited patterns

Do not add:

- persistent online or offline decoration
- repeated page titles in the same viewport
- a large button for an optional assistant
- separate Markdown editors for sections of one report
- permanent split panes when one pane is merely supporting information
- nested navigation with the visual weight of the global sidebar
- a card for every field
- a control whose only purpose is to fill empty space
- unpaginated primary record collections

## Decision rules

Material interface decisions follow these rules:

- `rule/one-primary-action`: one visually dominant action per surface.
- `rule/structure-before-containers`: establish hierarchy before adding boxes.
- `rule/smallest-intervention`: use the least disruptive control that completes
  the task.
- `rule/inline-before-modal`: keep work in context when it is safe and clear.
- `rule/preserve-mental-model`: preserve location, input, and object identity
  across state changes.
- `rule/keyboard-complete-flow`: complete the primary flow without a pointer.
- `rule/cover-reachable-states`: define every state the implementation exposes.

When rules conflict, protect task completion and user data first, then preserve
context, then reduce visual weight.
