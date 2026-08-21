import { McpServer } from "@modelcontextprotocol/server";
import {
  AFFECTED_RANGE_KINDS,
  AFFECTED_STATUSES,
  ASSET_IDENTIFIER_SCHEMES,
  ASSET_KINDS,
  CASE_PROFILES,
  CASE_STATUSES,
} from "@codevault/core";
import { SEVERITY_RATINGS } from "@codevault/standards";
import type {
  CreateAssetRequest,
  CreateCaseRequest,
  CreateVendorRequest,
} from "@codevault/contracts";
import * as z from "zod/v4";

import { type CodeVaultClient, type RecordFindingRequest } from "./client.js";
import { registerAssetTools } from "./tools/assets.js";
import { registerCaseTools } from "./tools/cases.js";
import { registerEvidenceTools } from "./tools/evidence.js";
import { registerFindingTools } from "./tools/findings.js";
import { registerIntakeTools } from "./tools/intake.js";
import { registerReportTools } from "./tools/reports.js";
import {
  compact,
  id,
  list,
  markdown,
  nullableHttpsUrl,
  result,
} from "./tools/shared.js";
import { registerVendorTools } from "./tools/vendors.js";

export function createCodeVaultMcpServer(client: CodeVaultClient): McpServer {
  const server = new McpServer(
    { name: "codevault-security", version: "1.0.0" },
    {
      instructions:
        "Call codevault_whoami before doing work. Search for an existing case, vendor, asset, or finding before creating one. Use returned UUIDs to connect records. Creating a finding records a draft with internal visibility and does not mark it validated, novel, fixed, approved, disclosed, or published. Do not claim those states in prose. Prefer stable asset identifiers such as PURL, CPE, repository URL, package coordinates, or serial/model identifiers. MCP write tools change CodeVault immediately and are audited as the authenticated user.",
    },
  );

  server.registerTool(
    "codevault_whoami",
    {
      title: "Check CodeVault authentication",
      description:
        "Return the authenticated CodeVault user and session expiry. Call this before reading or writing records.",
      annotations: { readOnlyHint: true },
    },
    () => result(() => client.whoAmI()),
  );

  server.registerTool(
    "codevault_list_cases",
    {
      title: "List CodeVault cases",
      description:
        "Find an existing research case by title or reference before creating a new case.",
      inputSchema: list.extend({
        profile: z.enum(CASE_PROFILES).optional(),
        status: z.enum(CASE_STATUSES).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    (input) => result(() => client.listCases(input)),
  );

  server.registerTool(
    "codevault_create_case",
    {
      title: "Create a CodeVault case",
      description:
        "Create a research case after codevault_list_cases confirms that a matching case does not exist.",
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        profile: z.enum(CASE_PROFILES),
        summary: z.string().max(2_000).optional(),
        restricted: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (input) =>
      result(() => client.createCase(compact(input) as CreateCaseRequest)),
  );

  server.registerTool(
    "codevault_list_vendors",
    {
      title: "List CodeVault vendors",
      description:
        "Find a vendor by name or reference before creating a duplicate.",
      inputSchema: list,
      annotations: { readOnlyHint: true },
    },
    (input) => result(() => client.listVendors(input)),
  );

  server.registerTool(
    "codevault_create_vendor",
    {
      title: "Create a CodeVault vendor",
      description:
        "Create a vendor after codevault_list_vendors confirms that it does not already exist.",
      inputSchema: z.object({
        name: z.string().min(1).max(200),
        websiteUrl: nullableHttpsUrl.optional(),
        sourceUrl: nullableHttpsUrl.optional(),
        sourceReviewedAt: z.iso.datetime().nullable().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (input) =>
      result(() => client.createVendor(compact(input) as CreateVendorRequest)),
  );

  server.registerTool(
    "codevault_list_assets",
    {
      title: "List CodeVault assets",
      description:
        "Find an asset by name, reference, identifier, kind, or case before creating one. Use the returned UUID when recording findings.",
      inputSchema: list.extend({
        caseId: id.optional(),
        kind: z.enum(ASSET_KINDS).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    (input) => result(() => client.listAssets(input)),
  );

  server.registerTool(
    "codevault_create_asset",
    {
      title: "Create a CodeVault asset",
      description:
        "Create a case asset with an optional stable identifier. Search first. Pass caseId to attach it to the research case.",
      inputSchema: z.object({
        name: z.string().min(1).max(200),
        kind: z.enum(ASSET_KINDS),
        vendorId: id.optional(),
        version: z.string().max(120).optional(),
        identifier: z
          .object({
            scheme: z.enum(ASSET_IDENTIFIER_SCHEMES),
            value: z.string().min(1).max(500),
          })
          .optional(),
        notes: z.string().max(5_000).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        caseId: id.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (input) =>
      result(() => client.createAsset(compact(input) as CreateAssetRequest)),
  );

  server.registerTool(
    "codevault_list_findings",
    {
      title: "List CodeVault findings",
      description:
        "Search for an existing finding by title or reference, optionally within a case or asset, before recording a duplicate.",
      inputSchema: list.extend({
        caseId: id.optional(),
        assetId: id.optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    (input) => result(() => client.listFindings(input)),
  );

  server.registerTool(
    "codevault_get_finding",
    {
      title: "Get a CodeVault finding",
      description:
        "Read the full finding, including narrative, assets, affected ranges, classifications, scores, claims, and references.",
      inputSchema: z.object({ findingId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ findingId }) => result(() => client.getFinding(findingId)),
  );

  server.registerTool(
    "codevault_record_finding",
    {
      title: "Record a complete draft finding",
      description:
        "Create a draft finding with narrative, CWE classifications, explicit asset UUID links, and affected-version ranges. Search cases, assets, and findings first. This does not validate, approve, disclose, score, or publish the finding.",
      inputSchema: z.object({
        caseId: id,
        title: z.string().min(1).max(200),
        summaryMarkdown: z.string().max(5_000).optional(),
        primaryAssetId: id.optional(),
        initialSeverity: z.enum(SEVERITY_RATINGS).optional(),
        technicalMarkdown: markdown.optional(),
        preconditionsMarkdown: markdown.optional(),
        attackPathMarkdown: markdown.optional(),
        impactMarkdown: markdown.optional(),
        reproductionMarkdown: markdown.optional(),
        remediationMarkdown: markdown.optional(),
        researcherNotesMarkdown: markdown.optional(),
        cweIds: z
          .array(z.string().regex(/^CWE-[1-9][0-9]*$/u))
          .max(25)
          .optional(),
        additionalAssetIds: z.array(id).max(100).optional(),
        affectedRanges: z
          .array(
            z.object({
              assetId: id,
              kind: z.enum(AFFECTED_RANGE_KINDS),
              expression: z.string().min(1).max(300),
              status: z.enum(AFFECTED_STATUSES),
              fixedIn: z.string().max(120).optional(),
              evidenceNote: z.string().max(2_000).optional(),
              verifiedAt: z.iso.datetime().optional(),
            }),
          )
          .max(100)
          .optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (input) =>
      result(() =>
        client.recordFinding(compact(input) as RecordFindingRequest),
      ),
  );

  registerFindingTools(server, client);
  registerIntakeTools(server, client);
  registerEvidenceTools(server, client);
  registerCaseTools(server, client);
  registerAssetTools(server, client);
  registerVendorTools(server, client);
  registerReportTools(server, client);

  return server;
}
