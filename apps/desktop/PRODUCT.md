# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a security researcher investigating vulnerabilities, preserving evidence, assessing findings, organizing cases, and coordinating responsible disclosure with vendors.

Organization administrators also manage membership, security policy, integrations, and the permissions that determine which research work a person may see or change.

## Product Purpose

CodeVault Security supports the work of discovering a vulnerability, proving it, deciding what it means, and disclosing it responsibly. Success means the researcher can understand the state of the work, move it forward without losing context, and publish only reviewed information to the intended audience.

## Positioning

CodeVault is a security research and coordinated-disclosure workspace, not a vulnerability-management suite. One canonical case supplies internal, vendor, and public views while enforcing the visibility rules for each audience.

AI may draft and propose work throughout the product. Humans own recorded truth and every external consequence. AI cannot send material to a vendor or publish it.

## Operating Context

Researchers work across cases, assets, findings, evidence, reports, vendor routes, disclosure events, submissions, correspondence, and prior-art checks. The desktop application also integrates with local AI providers and the local filesystem through a narrow Electron bridge.

Case and finding work can include embargoed or restricted information. A researcher may need to scan dense lists, move between related records, review generated drafts, and resume work after network or background-job failures.

This is a dense working environment. Compact lists must preserve the status, severity, ownership, and timing signals researchers use to triage work.

## Capabilities and Constraints

- Preserve the existing domain model, API contracts, permission checks, security boundaries, and Electron architecture. Mutation controls are gated by user permissions and call established application endpoints.
- AI can draft across the workflow but cannot make authoritative research decisions, contact vendors, or publish.
- Optional AI unavailability must not block core work. Explain it neutrally and reveal setup or troubleshooting progressively.
- Intake and AI output remain proposals until a permitted human accepts, edits, rejects, or merges them.
- Authoritative workflow state must be established before drafting or editing begins.
- Creation uses sequential, single-dialog flows. A failed or interrupted step must preserve the user's input and provide a clear recovery path.
- Finding writing shows one narrative section at a time. Local drafts survive errors, interruption, and navigation, and clear only after the application confirms successful persistence.
- Related-record previews must lead to the record or a scoped list. "View all" relationship navigation applies the exact relationship filter, shows that filter in the destination, and lets the user clear it.
- Internal, vendor, and public material are projections of one source of truth with enforced visibility boundaries.
- Restricted case existence is itself sensitive and must not be exposed to unauthorized users.
- The product must represent loading, empty, sparse, populated, stale or partial, error, permission, disabled, optimistic, destructive, and responsive states wherever those states are reachable.
- Advanced capabilities must remain available without overwhelming the primary path.
- Do not fabricate product claims, customer evidence, workflow outcomes, or functionality.

## Brand Commitments

The product name is CodeVault Security. Its voice is direct, precise, and calm. Security and severity meaning must never depend on color alone.

## Evidence on Hand

The repository contains realistic development seed data, domain documentation, architectural constraints, and working route implementations. It contains no customer testimonials, adoption claims, commercial benchmarks, or approved marketing claims; future work must not invent them.

## Product Principles

- AI drafts; humans own truth and external actions.
- Keep one canonical record while enforcing audience-specific visibility.
- Make Home action-first. Show what needs action before secondary analysis.
- Keep advanced research and disclosure controls available through clear progressive disclosure.
- Preserve context, user input, and recovery paths when work is interrupted.

## Accessibility & Inclusion

Primary tasks must be completable by keyboard with visible focus, semantic controls, and sensible focus movement. Every editor and interactive control must have an accessible name. The interface must support reduced motion, compact and wide layouts, long security identifiers, large values, and meaning that survives grayscale or nonvisual use.
