# MCP tool inventory

This file is generated from live MCP discovery. Do not edit it by hand.
Regenerate it with `bun run mcp:inventory` and check drift with
`bun run mcp:inventory:check`.

CodeVault exposes 53 authenticated MCP tools. Read-only and write
annotations are client hints. The API still applies the authenticated user's
permissions, case access, validation, revision checks, and audit behavior.
State-changing tools act immediately when a client calls them.

## Authentication

| Tool | Effect | Purpose |
| --- | --- | --- |
| `codevault_whoami` | Read only | Return the authenticated CodeVault user and session expiry. Call this before reading or writing records. |

## Cases and disclosure

| Tool | Effect | Purpose |
| --- | --- | --- |
| `codevault_add_case_note` | Additive write | Add a Markdown working note to a case immediately. |
| `codevault_add_case_stakeholder` | Additive write | Add a vendor, CNA, CERT, program, or other disclosure contact to a case. |
| `codevault_add_disclosure_event` | Additive write | Record a dated disclosure or coordination event immediately, with optional finding, stakeholder, and evidence artifact links. |
| `codevault_create_case` | Additive write | Create a research case after codevault_list_cases confirms that a matching case does not exist. |
| `codevault_get_case` | Read only | Read a research case, its owner, members, and policy packs. |
| `codevault_get_case_disclosure` | Read only | Read stakeholders, disclosure timeline events, embargo dates, and coordination warnings. |
| `codevault_get_case_readiness` | Read only | Evaluate the case's effective policy requirements and return every satisfied or missing item. |
| `codevault_list_case_notes` | Read only | Read the working notes recorded for a case. |
| `codevault_list_cases` | Read only | Find an existing research case by title or reference before creating a new case. |
| `codevault_set_case_embargo` | State changing | Create or replace the case's embargo and coordination dates immediately. |
| `codevault_update_case` | State changing | Update case metadata, ownership, access, profile, status, or disclosure support immediately. |

## Assets

| Tool | Effect | Purpose |
| --- | --- | --- |
| `codevault_add_asset_identifier` | Additive write | Attach a stable PURL, CPE, SWID, repository URL, vendor product, model, serial, or custom identifier. |
| `codevault_add_asset_relationship` | Additive write | Relate this asset to another asset, for example as a dependency, container, runtime, firmware target, or build source. |
| `codevault_add_asset_version` | Additive write | Record a version or release of an asset. |
| `codevault_create_asset` | Additive write | Create a case asset with an optional stable identifier. Search first. Pass caseId to attach it to the research case. |
| `codevault_get_asset` | Read only | Read an asset with identifiers, versions, relationships, vendor, notes, and metadata. |
| `codevault_list_assets` | Read only | Find an asset by name, reference, identifier, kind, or case before creating one. Use the returned UUID when recording findings. |
| `codevault_update_asset` | State changing | Update an asset immediately using its current revision. |

## Findings

| Tool | Effect | Purpose |
| --- | --- | --- |
| `codevault_add_finding_claim` | Additive write | Record a structured claim with its source, confidence, visibility, and optional machine-readable value. |
| `codevault_add_finding_identifier` | Additive write | Attach a real CVE, GHSA, OSV, vendor advisory, bug tracker, vendor reference, or custom identifier to a finding. |
| `codevault_add_finding_reference` | Additive write | Attach an external reference URL and its provenance to a finding. |
| `codevault_add_finding_score` | Additive write | Calculate and add a score from a vector, or add sourced intelligence. Set approve to true to approve it immediately; otherwise it remains proposed. |
| `codevault_approve_finding_score` | State changing | Approve the specified proposed score immediately as the authenticated CodeVault user. |
| `codevault_get_finding` | Read only | Read the full finding, including narrative, assets, affected ranges, classifications, scores, claims, and references. |
| `codevault_list_findings` | Read only | Search for an existing finding by title or reference, optionally within a case or asset, before recording a duplicate. |
| `codevault_record_finding` | Additive write | Create a draft finding with narrative, CWE classifications, explicit asset UUID links, and affected-version ranges. Search cases, assets, and findings first. This does not validate, approve, disclose, score, or publish the finding. |
| `codevault_update_finding` | State changing | Update a finding's narrative, lifecycle states, visibility, CWE classifications, or title immediately. |

## Evidence and artifacts

| Tool | Effect | Purpose |
| --- | --- | --- |
| `codevault_create_evidence` | Additive write | Create an evidence record and optionally attach already-uploaded artifact UUIDs. |
| `codevault_get_artifact_download` | Read only | Create a short-lived download URL for a stored evidence artifact. |
| `codevault_list_evidence` | Read only | Find evidence by case, finding, visibility, title, or reference. |
| `codevault_update_evidence` | State changing | Update evidence metadata, finding association, or complete artifact attachment list immediately. |
| `codevault_upload_evidence_file` | Additive write | Read a local file, hash it, upload it directly to CodeVault object storage, and attach it to a new or existing evidence record. If evidenceId is omitted, a new evidence record is created using evidenceTitle or the filename. |

## Vendors

| Tool | Effect | Purpose |
| --- | --- | --- |
| `codevault_add_vendor_contact_route` | Additive write | Add a structured vendor email or manual disclosure route with its submission requirements. |
| `codevault_add_vendor_public_key` | Additive write | Import a vendor PGP public key after verifying the expected fingerprint and source URL. |
| `codevault_create_vendor` | Additive write | Create a vendor after codevault_list_vendors confirms that it does not already exist. |
| `codevault_get_vendor` | Read only | Read a vendor with contact routes, public keys, provenance, and linked asset count. |
| `codevault_get_vendor_contact_route` | Read only | Read one vendor disclosure route and its requirements. |
| `codevault_list_vendors` | Read only | Find a vendor by name or reference before creating a duplicate. |
| `codevault_update_vendor` | State changing | Update or archive a vendor immediately. |
| `codevault_update_vendor_contact_route` | State changing | Update or deactivate a vendor disclosure route immediately. |
| `codevault_verify_vendor_public_key` | State changing | Mark a vendor public key verified immediately after matching its fingerprint to the supplied authoritative source. |

## Reports

| Tool | Effect | Purpose |
| --- | --- | --- |
| `codevault_approve_report` | State changing | Approve the report immediately as the authenticated CodeVault user if server-side lint and policy requirements pass. |
| `codevault_create_report` | Additive write | Create a case report for an internal, vendor, or public audience from a selected or default template. |
| `codevault_export_report` | State changing | Queue a PDF or Markdown export immediately. CodeVault enforces approval, lint, and publication rules. |
| `codevault_get_report` | Read only | Read a report with its Markdown sections, review state, source references, and approvals. |
| `codevault_lint_report` | Read only | Check a report for missing, inconsistent, unsafe, or publication-blocking content. |
| `codevault_list_report_exports` | Read only | List queued, running, completed, or failed PDF and Markdown exports for a report. |
| `codevault_list_report_templates` | Read only | List the report templates, audiences, visibility ceilings, and section outlines available for report creation. |
| `codevault_list_reports` | Read only | List every report created for a case. |
| `codevault_preview_report` | Read only | Render the current report as HTML and return the render plus lint results without exporting it. |
| `codevault_update_report` | State changing | Update a report title or TLP label immediately. |
| `codevault_update_report_section` | State changing | Write section Markdown, rename the section, or change its review state immediately. |
